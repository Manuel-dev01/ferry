import type { Offer } from '@ferry/shared'

// Money math for comparing payout routes. Prices from outside arrive as floats and are turned
// into integers once, at the edge; everything after that is bigint.

const USDT_SCALE = 1_000_000n
const SATS_PER_BTC = 100_000_000n

/**
 * Lightning routes are paid through Nimiq Pay's own swap, whose fee Ferry can't see in advance.
 * Estimates take this much off so they don't flatter Lightning against quoted routes.
 */
export const SWAP_ALLOWANCE_BPS = 100n // 1%

/** A float price per BTC (e.g. 77929.5 USD) as an integer in hundredths (7792950). */
export const priceToCents = (price: number): bigint => BigInt(Math.round(price * 100))

/** Sats a USDT amount buys at a BTC/USD price in cents. */
export const satsForUnits = (units: bigint, btcUsdCents: bigint): bigint =>
  (units * SATS_PER_BTC * 100n) / (USDT_SCALE * btcUsdCents)

/** USDT base units that sats were worth at a BTC/USD price in cents. */
export const unitsForSats = (sats: bigint, btcUsdCents: bigint): bigint =>
  (sats * btcUsdCents * USDT_SCALE) / (SATS_PER_BTC * 100n)

/** Sats after Ferry's allowance for Nimiq Pay's swap fee. */
export const afterSwapAllowance = (sats: bigint): bigint =>
  (sats * (10_000n - SWAP_ALLOWANCE_BPS)) / 10_000n

/** Msat for whole shillings, rounded up to a whole sat: Lightning services invoice whole sats. */
export const msatForKes = (kes: bigint, msatPerKes: bigint): bigint =>
  ((kes * msatPerKes + 999n) / 1000n) * 1000n

/**
 * Tando's M-Pesa addresses deliver about 98.98% of the shillings invoiced (measured 2026-11-01:
 * 989 of 1,000 and 4,949 of 5,000), then round down.
 */
export const TANDO_FEE_BPS = 102n

/** Shillings that arrive when a given amount is invoiced. */
export const kesDelivered = (invoiced: bigint): bigint =>
  (invoiced * (10_000n - TANDO_FEE_BPS)) / 10_000n

/** Shillings to invoice so that at least `net` arrive. */
export const kesToInvoice = (net: bigint): bigint => {
  const keep = 10_000n - TANDO_FEE_BPS
  let gross = (net * 10_000n + keep - 1n) / keep
  while (kesDelivered(gross) < net) gross += 1n
  return gross
}

/** Whole shillings an amount of sats pays, given the LNURL's msat-per-shilling multiplier. */
export const kesForSats = (sats: bigint, msatPerKes: bigint): bigint => (sats * 1000n) / msatPerKes

/** Whole local units for sats at a price per BTC in hundredths of the local unit. */
export const fiatForSats = (sats: bigint, priceCents: bigint): bigint =>
  (sats * priceCents) / (SATS_PER_BTC * 100n)

/** Local currency per 1 USDT, two decimals, from a received amount. */
export function rateFor(receiveWhole: bigint, units: bigint): string {
  if (units === 0n) return '0'
  const hundredths = (receiveWhole * USDT_SCALE * 100n) / units
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`
}

/** Fewer steps first: one-screen routes beat the hosted form unless it pays clearly more. */
const ONE_SCREEN_EDGE_BPS = 300n // 3%

/**
 * Marks one offer as recommended: the best payout, except that the one-screen M-Pesa route wins
 * unless another pays more than 3% extra.
 */
export function recommend(offers: Omit<Offer, 'recommended'>[]): Offer[] {
  if (!offers.length) return []
  const value = (o: Omit<Offer, 'recommended'>) => {
    const whole = BigInt(o.receive.split('.')[0] ?? '0')
    // Mavapay Money needs the user's own account, so it never gets the one-screen edge here.
    return o.route === 'mpesa_ln' ? (whole * (10_000n + ONE_SCREEN_EDGE_BPS)) / 10_000n : whole
  }
  let best = 0
  offers.forEach((o, i) => {
    if (value(o) > value(offers[best]!)) best = i
  })
  return offers
    .map((o, i) => ({ ...o, recommended: i === best }))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended))
}
