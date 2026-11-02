import { nimSwapRequestSchema, USDT0_ADDRESS, type NimSwapResponse } from '@ferry/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import {
  erc20Abi,
  getAddress,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import { z } from 'zod'
import type { AppEnv, Deps } from '../app'
import { nimSwaps } from '../db/schema'
import { HttpError } from '../errors'
import { parseJson } from './validate'

/** LendaSwap's API, as its SDK uses it. */
const SWAP_API = 'https://api.satora.io/swap/'
const TIMEOUT_MS = 8_000
const SWAP_MAX_AGE_S = 3 * 24 * 60 * 60
const POLYGON = 137
const COMPLETE = new Set(['clientredeemed', 'serverredeemed'])

const swapSchema = z.object({
  direction: z.string(),
  status: z.string(),
  evm_chain_id: z.number(),
  evm_claim_txid: z.string().nullish(),
  evm_htlc_address: z.string(),
  evm_coordinator_address: z.string().nullish(),
  target_evm_address: z.string().nullish(),
})

type Swap = z.infer<typeof swapSchema>

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * What a swap's claim paid: USDT on Polygon to the swap's own target address, in a successful
 * transaction that involves the swap's own contracts. A gasless claim may arrive through a relayer,
 * so those contracts can be the transaction's target or appear only in its logs.
 */
export function swapPayout(
  s: Pick<Swap, 'evm_htlc_address' | 'evm_coordinator_address' | 'target_evm_address'>,
  receipt: { status: 'success' | 'reverted'; to: Address | null; logs: Log[] },
): { to: Address; units: bigint } | null {
  if (receipt.status !== 'success' || !s.target_evm_address) return null
  const ofSwap = (a: string | null | undefined) =>
    same(a, s.evm_htlc_address) || same(a, s.evm_coordinator_address)
  if (!ofSwap(receipt.to) && !receipt.logs.some((l) => ofSwap(l.address))) return null
  const paid = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).find(
    (l) => same(l.address, USDT0_ADDRESS) && same(l.args.to, s.target_evm_address),
  )
  return paid ? { to: getAddress(paid.args.to), units: paid.args.value } : null
}

/**
 * NIM → USDT swaps for Proof of Ferry. Ferry never takes part in the swap; it only reads it back:
 * LendaSwap must report it complete, and its claim transaction must have paid USDT on Polygon to
 * the swap's own target address, through the swap's own contracts.
 */
export function swapRoutes(deps: Deps) {
  const { polygon, fetch: fetchImpl } = deps
  const db = deps.db?.db ?? null
  const r = new Hono<AppEnv>()

  r.post('/nim-swaps', async (c) => {
    if (!db) throw new HttpError(503, 'DB_UNAVAILABLE', "Ferry can't record this right now")
    const { swapId } = await parseJson(c, nimSwapRequestSchema)

    const [known] = await db.select().from(nimSwaps).where(eq(nimSwaps.swapId, swapId)).limit(1)
    if (known) return c.json(confirmed(known.amountUnits))

    const res = await fetchImpl(SWAP_API + encodeURIComponent(swapId), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null)
    if (!res) throw new HttpError(502, 'PARTNER_HTTP_ERROR', "LendaSwap isn't answering")
    // LendaSwap answers an unknown or malformed ID with 400 (verified 2026-11-02), not 404.
    if (res.status === 404 || res.status === 400) {
      throw new HttpError(404, 'NOT_FOUND', 'No swap with that ID')
    }
    if (!res.ok) throw new HttpError(502, 'PARTNER_HTTP_ERROR', `LendaSwap replied ${res.status}`)
    const parsed = swapSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) {
      throw new HttpError(502, 'PARTNER_BAD_RESPONSE', 'LendaSwap sent an unexpected swap')
    }
    const s = parsed.data
    if (s.direction !== 'lightning_to_evm' || s.evm_chain_id !== POLYGON) {
      throw new HttpError(400, 'NOT_A_NIM_SWAP', 'That swap does not pay out on Polygon')
    }
    if (!COMPLETE.has(s.status) || !s.evm_claim_txid) return c.json(pending(), 202)
    if (!s.target_evm_address || !isAddress(s.target_evm_address)) {
      throw new HttpError(400, 'NOT_A_NIM_SWAP', 'That swap has no Polygon address to check')
    }

    const claimTx = s.evm_claim_txid.toLowerCase() as Hex
    const receipt = await polygon.getTransactionReceipt({ hash: claimTx }).catch(() => null)
    if (!receipt) return c.json(pending(), 202)
    const paid = swapPayout(s, receipt)
    if (!paid) {
      throw new HttpError(400, 'NOT_A_NIM_SWAP', "That swap's claim didn't pay USDT on Polygon")
    }
    const block = await polygon.getBlock({ blockNumber: receipt.blockNumber })
    if (Date.now() / 1000 - Number(block.timestamp) > SWAP_MAX_AGE_S) {
      throw new HttpError(400, 'TOO_OLD', 'That swap is too old to record')
    }

    await db
      .insert(nimSwaps)
      .values({
        swapId,
        claimTx,
        toAddress: paid.to,
        amountUnits: paid.units,
        blockNumber: receipt.blockNumber,
      })
      .onConflictDoNothing()
    c.get('log').info({ swapId, units: paid.units.toString() }, 'nim swap recorded')
    return c.json(confirmed(paid.units))
  })

  return r
}

const confirmed = (units: bigint): NimSwapResponse => ({
  status: 'confirmed',
  amountUnits: units.toString(),
})
const pending = (): NimSwapResponse => ({ status: 'pending', amountUnits: null })
