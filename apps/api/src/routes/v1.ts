import {
  computeQuote,
  CORRIDORS,
  corridorCurrencySchema,
  createOfframpRequestSchema,
  maskAccount,
  MoneyFormatError,
  normalizeAccountIdentifier,
  parseUnits,
  submitSignatureRequestSchema,
  USDT_DECIMALS,
  verifyAccountRequestSchema,
  type CorridorCurrency,
  type MetaResponse,
  type QuoteAmounts,
  type QuoteResponse,
  type StatsResponse,
} from '@ferry/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getAddress } from 'viem'
import { z } from 'zod'
import type { AppEnv, Deps } from '../app'
import { handoffs, lnPayouts, nimSwaps } from '../db/schema'
import { HttpError } from '../errors'
import { ORDER_VALID_MS } from '../orders/mock-engine'
import { reconcileMpesa } from '../mpesa'
import { computeStats } from '../proof'
import { parseJson, parseValue } from './validate'

const QUOTE_VALID_S = ORDER_VALID_MS / 1000
const STATS_CACHE_MS = 30_000
const USDT_SCALE = 10n ** BigInt(USDT_DECIMALS)

const quoteQuerySchema = z.object({
  currency: corridorCurrencySchema,
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  amountIn: z.enum(['usdt', 'fiat']),
})

/** Paycrest prices by order size in whole USDT; fiat-entered amounts use a typical size. */
function rateBucket(amount: string, amountIn: 'usdt' | 'fiat'): bigint {
  if (amountIn === 'fiat') return 50n
  try {
    const whole = (parseUnits(amount, USDT_DECIMALS) + USDT_SCALE - 1n) / USDT_SCALE
    return whole > 0n ? whole : 1n
  } catch {
    return 1n
  }
}

export function v1Routes(deps: Deps) {
  const r = new Hono<AppEnv>()
  const { env, paycrest } = deps

  const requireCorridor = (currency: CorridorCurrency) => {
    if (!env.CORRIDORS_ENABLED.includes(currency)) {
      throw new HttpError(503, 'CORRIDOR_PAUSED', 'Payouts to this country are paused right now')
    }
  }

  const findInstitution = async (currency: CorridorCurrency, code: string) => {
    const institution = (await paycrest.public.institutions(currency)).find((i) => i.code === code)
    if (!institution)
      throw new HttpError(400, 'UNKNOWN_INSTITUTION', "We don't support that bank yet")
    return institution
  }

  /** Server-side quote. Never trusts amounts computed by the client. */
  async function quote(currency: CorridorCurrency, amount: string, amountIn: 'usdt' | 'fiat') {
    requireCorridor(currency)
    const rate = await paycrest.public.sellRate(currency, rateBucket(amount, amountIn))
    if (!rate)
      throw new HttpError(503, 'CORRIDOR_PAUSED', 'Payouts to this country are paused right now')
    let amounts: QuoteAmounts
    try {
      amounts = computeQuote({ amountIn, amount, rate, feeBps: env.ferryFeeBps })
    } catch (err) {
      if (err instanceof MoneyFormatError)
        throw new HttpError(400, 'INVALID_AMOUNT', 'That amount looks wrong')
      throw err
    }
    return { rate, amounts }
  }

  const checkLimits = (amounts: QuoteAmounts) => {
    if (amounts.amountUnits < env.limits.minUnits || amounts.amountUnits > env.limits.maxUnits) {
      throw new HttpError(400, 'OUTSIDE_LIMITS', 'That amount is outside the per-payout limits', {
        minUsd: env.LIMIT_MIN_USD,
        maxUsd: env.LIMIT_MAX_USD,
      })
    }
  }

  r.get('/meta', (c) => {
    const body: MetaResponse = {
      corridors: CORRIDORS.map((corridor) => ({
        ...corridor,
        enabled: env.CORRIDORS_ENABLED.includes(corridor.currency),
      })),
      limits: {
        minUsd: env.LIMIT_MIN_USD,
        maxUsd: env.LIMIT_MAX_USD,
        dailyUsd: env.LIMIT_DAILY_USD,
      },
      fees: { ferryFeeBps: env.ferryFeeBps, firstOrderFree: false },
      features: { lightning: false, onramp: false, testDrive: false },
      paycrestMode: paycrest.keyed.mode,
      payoutRoute: env.PAYOUT_ROUTE,
      gasTopup: env.GAS_TOPUP_ENABLED && !!deps.relayer && !!deps.db,
      relayer: deps.relayer?.account.address ?? null,
    }
    return c.json(body)
  })

  // Proof of Ferry: real cash-outs Ferry saw on-chain, minus the builder's own wallets. Simulated
  // orders never count. Cached briefly, since the page is public.
  let statsCache: { body: StatsResponse; at: number } | null = null
  r.get('/stats', async (c) => {
    const db = deps.db?.db
    if (!db) throw new HttpError(503, 'DB_UNAVAILABLE', "Ferry can't read this right now")
    if (!statsCache || Date.now() - statsCache.at > STATS_CACHE_MS) {
      const rows = await db
        .select({
          txHash: handoffs.txHash,
          fromAddress: handoffs.fromAddress,
          amountUnits: handoffs.amountUnits,
          currency: handoffs.currency,
          country: handoffs.country,
          channel: handoffs.channel,
          createdAt: handoffs.createdAt,
          receivedAt: handoffs.receivedAt,
        })
        .from(handoffs)
      // Payouts whose sender closed Ferry before the receipt came still get counted.
      await reconcileMpesa(db, deps.fetch).catch(() => undefined)
      const lnRows = await db
        .select({
          paymentHash: lnPayouts.paymentHash,
          country: lnPayouts.country,
          channel: lnPayouts.channel,
          amountUnits: lnPayouts.amountUnits,
          createdAt: lnPayouts.createdAt,
          deliveredAt: lnPayouts.deliveredAt,
          timed: lnPayouts.timed,
        })
        .from(lnPayouts)
        .where(eq(lnPayouts.route, 'mpesa_ln'))
      const nimRows = await db
        .select({ toAddress: nimSwaps.toAddress, amountUnits: nimSwaps.amountUnits })
        .from(nimSwaps)
      statsCache = {
        body: computeStats(rows, env.PROOF_EXCLUDE_ADDRESSES, Date.now(), lnRows, nimRows),
        at: Date.now(),
      }
    }
    return c.json(statsCache.body)
  })

  r.get('/institutions/:currency', async (c) => {
    const currency = parseValue(corridorCurrencySchema, c.req.param('currency'))
    return c.json(await paycrest.public.institutions(currency))
  })

  r.get('/quote', async (c) => {
    const q = parseValue(quoteQuerySchema, c.req.query())
    const { rate, amounts } = await quote(q.currency, q.amount, q.amountIn)
    const body: QuoteResponse = {
      currency: q.currency,
      rate,
      amountUnits: amounts.amountUnits.toString(),
      ferryFeeUnits: amounts.ferryFeeUnits.toString(),
      youSendUnits: amounts.youSendUnits.toString(),
      theyReceiveMinor: amounts.theyReceiveMinor.toString(),
      validForSeconds: QUOTE_VALID_S,
      fetchedAt: Date.now(),
    }
    return c.json(body)
  })

  r.post('/accounts/verify', async (c) => {
    const body = await parseJson(c, verifyAccountRequestSchema)
    requireCorridor(body.currency)
    const institution = await findInstitution(body.currency, body.institution)
    const identifier = normalizeAccountIdentifier(
      body.currency,
      institution.type,
      body.accountIdentifier,
    )
    if (!identifier) throw new HttpError(400, 'INVALID_ACCOUNT', 'That account number looks wrong')
    const accountName = await paycrest.keyed.verifyAccount(institution.code, identifier)
    return c.json({ accountName, masked: maskAccount(identifier) })
  })

  r.post('/orders/offramp', async (c) => {
    const body = await parseJson(c, createOfframpRequestSchema)
    const institution = await findInstitution(body.currency, body.institution)
    const identifier = normalizeAccountIdentifier(
      body.currency,
      institution.type,
      body.accountIdentifier,
    )
    if (!identifier) throw new HttpError(400, 'INVALID_ACCOUNT', 'That account number looks wrong')
    const { rate, amounts } = await quote(body.currency, body.amount, body.amountIn)
    checkLimits(amounts)
    // Dormant path: a per-wallet daily cap would go here, inside the order-creation transaction.
    const created = await deps.orders.create({
      currency: body.currency,
      institution: institution.code,
      institutionName: institution.name,
      accountIdentifier: identifier,
      evmAddress: getAddress(body.evmAddress),
      rate,
      quote: amounts,
    })
    c.get('log').info({ orderId: created.orderId, currency: body.currency }, 'order created')
    return c.json(created, 201)
  })

  r.post('/orders/:id/signature', async (c) => {
    const { signature } = await parseJson(c, submitSignatureRequestSchema)
    const order = await deps.orders.submitSignature(
      c.req.param('id'),
      c.req.header('X-Client-Secret'),
      signature,
    )
    return c.json(order)
  })

  r.get('/orders/:id', (c) =>
    c.json(deps.orders.get(c.req.param('id'), c.req.header('X-Client-Secret'))),
  )

  return r
}
