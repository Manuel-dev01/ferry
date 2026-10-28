import {
  FONBNK_CHANNELS,
  gasTopupRequestSchema,
  handoffRequestSchema,
  hexSchema,
  USDT0_ADDRESS,
  type GasTopupResponse,
  type HandoffResponse,
} from '@ferry/shared'
import { and, count, eq, gte } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  BaseError,
  erc20Abi,
  getAddress,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import type { AppEnv, Deps } from '../app'
import { gasTopups, handoffs } from '../db/schema'
import { HttpError } from '../errors'
import { polygonFees } from '../polygon'
import { parseJson, parseValue } from './validate'

/** Gas limit Nimiq Pay sets for one USDT transfer: its estimate plus padding. */
export const TRANSFER_GAS = 120_000n
const DAY_MS = 24 * 60 * 60_000
const RECEIPT_TIMEOUT_MS = 60_000

/** POL a wallet needs so the wallet's own check (gas limit × max fee) passes, with 25% margin. */
export const transferGasNeedWei = (maxFeePerGas: bigint) => (TRANSFER_GAS * maxFeePerGas * 5n) / 4n

/**
 * The one USDT transfer a wallet sent itself: the transaction calls the USDT contract directly and
 * moves the sender's own tokens. Contract-made transfers (a Gateway order, a swap) don't count.
 */
export function directUsdtTransfer(receipt: {
  from: Address
  to: Address | null
  logs: Log[]
}): { from: Address; to: Address; value: bigint } | null {
  const token = USDT0_ADDRESS.toLowerCase()
  if (receipt.to?.toLowerCase() !== token) return null
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: 'Transfer',
    logs: receipt.logs,
  }).filter((l) => l.address.toLowerCase() === token)
  const t = transfers.length === 1 ? transfers[0] : undefined
  if (!t || getAddress(t.args.from) !== getAddress(receipt.from)) return null
  return { from: getAddress(t.args.from), to: getAddress(t.args.to), value: t.args.value }
}

const short = (err: unknown) => (err instanceof BaseError ? err.shortMessage : String(err))

/**
 * Cash-outs that a payout partner (Fonbnk) completes. The user's wallet sends USDT straight to the
 * partner's deposit address; Ferry only tops up gas and records the transfer it can see on-chain.
 */
export function handoffRoutes(deps: Deps) {
  const { env, polygon, relayer } = deps
  const db = deps.db?.db ?? null
  const r = new Hono<AppEnv>()
  let topupInFlight = false

  r.post('/gas', async (c) => {
    const log = c.get('log')
    if (!env.GAS_TOPUP_ENABLED)
      throw new HttpError(404, 'GAS_TOPUP_DISABLED', 'Gas top-ups are off')
    if (!relayer || !db) {
      throw new HttpError(503, 'GAS_UNAVAILABLE', "Ferry can't send gas right now")
    }
    const address = getAddress((await parseJson(c, gasTopupRequestSchema)).address)

    const fees = await polygonFees(polygon)
    const need = transferGasNeedWei(fees.maxFeePerGas)
    const target = need > env.gasTopupCapWei ? env.gasTopupCapWei : need
    const [pol, usdt] = await Promise.all([
      polygon.getBalance({ address }),
      polygon.readContract({
        address: USDT0_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }),
    ])
    if (pol >= target) {
      const res: GasTopupResponse = { status: 'already_funded', txHash: null }
      return c.json(res)
    }
    // Gas is for cashing out, so only wallets holding at least the minimum cash-out qualify.
    if (usdt < env.limits.minUnits) {
      throw new HttpError(400, 'NOTHING_TO_SEND', 'Gas is only for wallets with USDT to cash out')
    }

    const since = new Date(Date.now() - DAY_MS)
    const [[mine], [all]] = await Promise.all([
      db
        .select({ n: count() })
        .from(gasTopups)
        .where(and(eq(gasTopups.address, address), gte(gasTopups.createdAt, since))),
      db.select({ n: count() }).from(gasTopups).where(gte(gasTopups.createdAt, since)),
    ])
    if ((mine?.n ?? 0) >= env.GAS_TOPUP_PER_ADDRESS_DAY) {
      throw new HttpError(429, 'GAS_LIMIT', 'This wallet already got gas today')
    }
    if ((all?.n ?? 0) >= env.GAS_TOPUP_DAILY_MAX) {
      throw new HttpError(429, 'GAS_LIMIT', 'Gas top-ups are paused until tomorrow')
    }
    // One relayer transaction at a time keeps its nonces in order.
    if (topupInFlight) {
      throw new HttpError(429, 'GAS_BUSY', 'Ferry is sending gas to someone else. Try again.')
    }
    topupInFlight = true
    try {
      const value = target - pol
      const request = await relayer.prepareTransactionRequest({ to: address, value, ...fees })
      const serialized = await relayer.signTransaction(request)
      const txHash = keccak256(serialized)
      // Recorded before broadcast, so the limits hold even when the outcome is unknown.
      await db.insert(gasTopups).values({ address, amountWei: value.toString(), txHash })
      log.info({ address, wei: value.toString(), txHash }, 'sending gas top-up')
      try {
        await polygon.sendRawTransaction({ serializedTransaction: serialized })
      } catch (err) {
        // The node may have accepted it before failing; never resend, report unknown.
        log.warn({ txHash, err: short(err) }, 'gas top-up broadcast error; outcome unknown')
        const res: GasTopupResponse = { status: 'unknown', txHash }
        return c.json(res, 202)
      }
      const receipt = await polygon
        .waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS })
        .catch(() => null)
      const res: GasTopupResponse = {
        status: receipt ? (receipt.status === 'success' ? 'sent' : 'reverted') : 'pending',
        txHash,
      }
      return c.json(res, receipt ? 200 : 202)
    } finally {
      topupInFlight = false
    }
  })

  r.post('/handoffs', async (c) => {
    if (!db) throw new HttpError(503, 'DB_UNAVAILABLE', "Ferry can't record this right now")
    const body = await parseJson(c, handoffRequestSchema)
    const txHash = body.txHash.toLowerCase() as Hex
    if (txHash.length !== 66) throw new HttpError(400, 'INVALID_REQUEST', 'Not a transaction hash')
    if (!FONBNK_CHANNELS[body.currency].includes(body.channel)) {
      throw new HttpError(400, 'INVALID_REQUEST', 'That payout method is not offered there')
    }

    const [known] = await db.select().from(handoffs).where(eq(handoffs.txHash, txHash)).limit(1)
    if (known) return c.json(view(known))

    const receipt = await polygon.getTransactionReceipt({ hash: txHash }).catch(() => null)
    if (!receipt) return c.json(pending(txHash, 'pending'), 202)
    if (receipt.status !== 'success') return c.json(pending(txHash, 'reverted'))

    const t = directUsdtTransfer(receipt)
    if (!t) {
      throw new HttpError(
        400,
        'NOT_A_TRANSFER',
        'That transaction is not a USDT transfer from a wallet',
      )
    }
    const row = {
      txHash,
      provider: body.provider,
      fromAddress: t.from,
      toAddress: t.to,
      amountUnits: t.value,
      currency: body.currency,
      channel: body.channel,
      blockNumber: receipt.blockNumber,
    }
    await db.insert(handoffs).values(row).onConflictDoNothing()
    c.get('log').info(
      { txHash, provider: row.provider, currency: row.currency, units: row.amountUnits.toString() },
      'handoff recorded',
    )
    return c.json(view(row))
  })

  r.get('/handoffs/:tx', async (c) => {
    if (!db) throw new HttpError(503, 'DB_UNAVAILABLE', "Ferry can't read this right now")
    const tx = parseValue(hexSchema, c.req.param('tx')).toLowerCase()
    const [row] = await db.select().from(handoffs).where(eq(handoffs.txHash, tx)).limit(1)
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'No hand-off with that transaction')
    return c.json(view(row))
  })

  return r
}

function view(row: { txHash: string; amountUnits: bigint; toAddress: string }): HandoffResponse {
  return {
    status: 'confirmed',
    txHash: row.txHash as Hex,
    amountUnits: row.amountUnits.toString(),
    toAddress: getAddress(row.toAddress),
  }
}

const pending = (txHash: Hex, status: 'pending' | 'reverted'): HandoffResponse => ({
  status,
  txHash,
  amountUnits: null,
  toAddress: null,
})
