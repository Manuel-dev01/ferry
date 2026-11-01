import {
  FONBNK_COUNTRIES,
  mavapayInvoiceRequestSchema,
  mpesaInvoiceRequestSchema,
  mpesaLightningAddress,
  normalizeKenyanPhone,
  offersQuerySchema,
  type FonbnkCountry,
  type LnInvoiceResponse,
  type Offer,
  type OffersResponse,
} from '@ferry/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Deps } from '../app'
import { lnPayouts } from '../db/schema'
import { HttpError } from '../errors'
import {
  requestInvoice,
  resolveLightningAddress,
  validateInvoice,
  type FetchLike,
  type PayRequest,
} from '../lightning'
import {
  afterSwapAllowance,
  fiatForSats,
  kesDelivered,
  kesForSats,
  kesToInvoice,
  msatForKes,
  priceToCents,
  rateFor,
  recommend,
  satsForUnits,
  unitsForSats,
} from '../payouts'
import { recordDelivery, tandoStatus } from '../mpesa'
import { parseJson, parseValue } from './validate'

const TIMEOUT_MS = 8_000
const PRICE_TTL_MS = 60_000
const QUOTE_TTL_MS = 30_000
const LNURL_TTL_MS = 10 * 60_000

/** Any number works for reading the service's limits and rate; this one is unassigned. */
const MPESA_PROBE_NUMBER = '254700000000'
/** Mavapay Money pays out to banks in these countries. */
const MAVAPAY_COUNTRIES: Partial<Record<FonbnkCountry, string>> = {
  NG: 'NGN',
  KE: 'KES',
  ZA: 'ZAR',
}

const mpesaCurrencySchema = z.object({
  code: z.literal('KES'),
  minSendable: z.number(),
  maxSendable: z.number(),
  multiplier: z.number().positive(),
})

const fonbnkQuoteSchema = z.object({
  payout: z.object({
    cashout: z.object({
      amountAfterFees: z.number(),
      exchangeRate: z.number(),
      totalChargedFees: z.number(),
    }),
  }),
})

/** A tiny time-boxed cache, so a busy page doesn't hammer partners. */
function cached<T>(ttl: number) {
  const store = new Map<string, { at: number; value: Promise<T> }>()
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < ttl) return hit.value
    const value = load().catch((err: unknown) => {
      store.delete(key)
      throw err
    })
    store.set(key, { at: Date.now(), value })
    return value
  }
}

async function getJson(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok)
    throw new HttpError(502, 'PARTNER_HTTP_ERROR', `A payout partner replied ${res.status}`)
  return res.json()
}

const wholeString = (n: number) => String(Math.floor(n))

/**
 * Cash-out routes other than the hosted Fonbnk form: Lightning invoices from Kenyan M-Pesa
 * numbers and Mavapay Money addresses, paid by the user's wallet through payLightningInvoice.
 * The server only fetches invoices and statuses from fixed partner domains; it never pays.
 */
export function payoutRoutes(deps: Deps) {
  const { fetch: fetchImpl } = deps
  const db = deps.db?.db ?? null
  const r = new Hono<AppEnv>()

  const priceCache = cached<bigint>(PRICE_TTL_MS)
  const btcUsdCents = () =>
    priceCache('btc-usd', async () => {
      const body = z
        .object({ bitcoin: z.object({ usd: z.number().positive() }) })
        .parse(
          await getJson(
            fetchImpl,
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
          ),
        )
      return priceToCents(body.bitcoin.usd)
    })

  const mavapayPriceCache = cached<bigint>(PRICE_TTL_MS)
  /** Mavapay's own price per BTC, in hundredths of the local unit. */
  const mavapayPrice = (currency: string) =>
    mavapayPriceCache(currency, async () => {
      const body = z
        .object({ data: z.object({ btcPriceInUnitCurrency: z.number().positive() }) })
        .parse(await getJson(fetchImpl, `https://api.mavapay.co/api/v1/price?currency=${currency}`))
      return priceToCents(body.data.btcPriceInUnitCurrency)
    })

  // Estimates may use a cached rate; invoices always read a fresh one, because the service
  // converts at its current rate and rounds shillings down.
  const lnurlCache = cached<{ payRequest: PayRequest; raw: unknown }>(LNURL_TTL_MS)
  const mpesaPayRequest = (phone: string, fresh: boolean) => {
    const load = () => resolveLightningAddress(fetchImpl, mpesaLightningAddress(phone))
    return fresh ? load() : lnurlCache(phone, load)
  }
  const mpesaCurrency = async (phone = MPESA_PROBE_NUMBER, fresh = false) => {
    const { payRequest, raw } = await mpesaPayRequest(phone, fresh)
    const currency = mpesaCurrencySchema.safeParse((raw as { currency?: unknown }).currency)
    if (!currency.success) {
      throw new HttpError(502, 'LNURL_NO_CURRENCY', 'The M-Pesa service gave no shilling rate')
    }
    return { payRequest, currency: currency.data }
  }

  const fonbnkCache = cached<Omit<Offer, 'recommended'>>(QUOTE_TTL_MS)
  const fonbnkOffer = (country: FonbnkCountry, channel: string, units: bigint) =>
    fonbnkCache(`${country}:${channel}:${units}`, async () => {
      const info = FONBNK_COUNTRIES[country]
      const body = fonbnkQuoteSchema.parse(
        await getJson(fetchImpl, 'https://api.fonbnk.com/api/internal/pay-widget/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deposit: {
              paymentChannel: 'crypto',
              currencyType: 'crypto',
              currencyCode: 'POLYGON_USDT',
              // Fonbnk's API takes a plain number; it is only a quote, never money moved.
              amount: Number(units) / 1e6,
            },
            payout: {
              paymentChannel: channel,
              currencyType: 'fiat',
              currencyCode: info.currency,
              countryIsoCode: country,
            },
            refreshQuote: true,
          }),
        }),
      )
      const q = body.payout.cashout
      return {
        route: 'fonbnk' as const,
        receive: wholeString(q.amountAfterFees),
        currency: info.currency,
        rate: q.exchangeRate.toFixed(2),
        fee: q.totalChargedFees > 0 ? wholeString(q.totalChargedFees) : null,
        estimate: false,
      }
    })

  r.get('/offers', async (c) => {
    const q = parseValue(offersQuerySchema, c.req.query())
    const units = BigInt(q.units)
    const tasks: Promise<Omit<Offer, 'recommended'> | null>[] = []
    const log = c.get('log')
    const soft = <T>(p: Promise<T>, route: string) =>
      p.catch((err: unknown) => {
        // One partner being down must not hide the others.
        log.warn({ route, err: err instanceof Error ? err.message : String(err) }, 'offer failed')
        return null
      })

    tasks.push(soft(fonbnkOffer(q.country, q.channel, units), 'fonbnk'))

    if (q.country === 'KE' && q.channel === 'mobile_money') {
      tasks.push(
        soft(
          (async () => {
            const [{ currency }, cents] = await Promise.all([mpesaCurrency(), btcUsdCents()])
            const sats = afterSwapAllowance(satsForUnits(units, cents))
            const kes = kesDelivered(kesForSats(sats, BigInt(Math.round(currency.multiplier))))
            return {
              route: 'mpesa_ln' as const,
              receive: kes.toString(),
              currency: 'KES',
              rate: rateFor(kes, units),
              fee: null,
              estimate: true,
            }
          })(),
          'mpesa_ln',
        ),
      )
    }

    const mavapayCurrency = MAVAPAY_COUNTRIES[q.country]
    if (mavapayCurrency && q.channel === 'bank') {
      tasks.push(
        soft(
          (async () => {
            const [price, cents] = await Promise.all([mavapayPrice(mavapayCurrency), btcUsdCents()])
            const sats = afterSwapAllowance(satsForUnits(units, cents))
            const receive = fiatForSats(sats, price)
            return {
              route: 'mavapay_ln' as const,
              receive: receive.toString(),
              currency: mavapayCurrency,
              rate: rateFor(receive, units),
              fee: null,
              estimate: true,
            }
          })(),
          'mavapay_ln',
        ),
      )
    }

    const offers = (await Promise.all(tasks)).filter((o) => o !== null)
    const body: OffersResponse = { offers: recommend(offers) }
    return c.json(body)
  })

  // A Kenyan phone number's own Lightning invoice, for an amount in shillings.
  r.post('/ln/mpesa', async (c) => {
    const body = await parseJson(c, mpesaInvoiceRequestSchema)
    const phone = normalizeKenyanPhone(body.phone)
    if (!phone) throw new HttpError(400, 'INVALID_PHONE', "That isn't a Kenyan mobile number")
    const { payRequest, currency } = await mpesaCurrency(phone, true)
    if (body.kes < currency.minSendable || body.kes > currency.maxSendable) {
      throw new HttpError(
        400,
        'LN_AMOUNT_OUT_OF_RANGE',
        `M-Pesa takes KSh ${currency.minSendable} to KSh ${currency.maxSendable} at a time`,
      )
    }
    // `kes` is what should arrive; invoice enough to cover Tando's cut.
    const gross = kesToInvoice(BigInt(body.kes))
    if (gross > BigInt(currency.maxSendable)) {
      throw new HttpError(
        400,
        'LN_AMOUNT_OUT_OF_RANGE',
        `M-Pesa takes up to KSh ${kesDelivered(BigInt(currency.maxSendable))} at a time`,
      )
    }
    const amountMsat = msatForKes(gross, BigInt(Math.round(currency.multiplier)))
    const { invoice } = await requestInvoice(fetchImpl, payRequest, amountMsat)
    const v = validateInvoice(invoice.pr, {
      amountMsat,
      metadata: payRequest.metadata,
      nowSeconds: Math.floor(Date.now() / 1000),
    })
    c.get('log').info({ route: 'mpesa_ln', kes: body.kes, hash: v.paymentHash }, 'invoice issued')
    if (db) {
      const sats = amountMsat / 1000n
      const units = await btcUsdCents()
        .then((cents) => unitsForSats(sats, cents))
        .catch(() => null)
      if (units !== null) {
        await db
          .insert(lnPayouts)
          .values({
            paymentHash: v.paymentHash,
            route: 'mpesa_ln',
            country: 'KE',
            channel: 'mobile_money',
            fiatAmount: BigInt(body.kes),
            sats,
            amountUnits: units,
          })
          .onConflictDoNothing()
          .catch((err: unknown) =>
            c.get('log').warn({ err: String(err) }, 'ln payout not recorded'),
          )
      }
    }
    const res: LnInvoiceResponse = {
      invoice: invoice.pr,
      paymentHash: v.paymentHash,
      sats: Number(amountMsat / 1000n),
      expiresAt: v.expiresAt,
      receive: String(body.kes),
      currency: 'KES',
    }
    return c.json(res)
  })

  // Delivery status from Tando, which publishes the M-Pesa receipt once paid out.
  r.get('/ln/mpesa/:hash', async (c) => {
    const hash = c.req.param('hash').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, 'INVALID_REQUEST', 'Bad hash')
    const body = await tandoStatus(fetchImpl, hash)
    if (db) await recordDelivery(db, hash, body).catch(() => undefined)
    return c.json(body)
  })

  // An invoice from the user's own Mavapay Money address, sized from a USDT amount.
  r.post('/ln/mavapay', async (c) => {
    const body = await parseJson(c, mavapayInvoiceRequestSchema)
    const address = body.address.toLowerCase()
    const units = BigInt(body.units)
    const { payRequest } = await resolveLightningAddress(fetchImpl, address)
    const sats = satsForUnits(units, await btcUsdCents())
    const amountMsat = sats * 1000n
    const { invoice } = await requestInvoice(fetchImpl, payRequest, amountMsat)
    const v = validateInvoice(invoice.pr, {
      amountMsat,
      metadata: payRequest.metadata,
      nowSeconds: Math.floor(Date.now() / 1000),
    })
    c.get('log').info({ route: 'mavapay_ln', sats: sats.toString() }, 'invoice issued')
    const res: LnInvoiceResponse = {
      invoice: invoice.pr,
      paymentHash: v.paymentHash,
      sats: Number(sats),
      expiresAt: v.expiresAt,
      receive: null,
      currency: 'BTC',
    }
    return c.json(res)
  })

  return r
}
