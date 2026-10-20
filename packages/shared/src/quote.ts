import { MoneyFormatError, parseUnits, USDT_DECIMALS } from './money'

// Rates are decimal strings ("1353.05" fiat per USDT). We scale them to integers so every
// conversion is exact bigint arithmetic. Fiat amounts are handled in minor units (kobo, cents).

export const RATE_DECIMALS = 6
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS)
const USDT_SCALE = 10n ** BigInt(USDT_DECIMALS)
const FIAT_MINOR = 100n

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

export function parseRate(rate: string): bigint {
  const trimmed = rate.trim()
  const [, frac = ''] = trimmed.split('.')
  // Paycrest sometimes returns more precision than we need; truncate rather than reject.
  const normalized =
    frac.length > RATE_DECIMALS
      ? trimmed.slice(0, trimmed.length - (frac.length - RATE_DECIMALS))
      : trimmed
  const scaled = parseUnits(normalized, RATE_DECIMALS)
  if (scaled === 0n) throw new MoneyFormatError('Rate must be positive')
  return scaled
}

/** USDT base units → fiat minor units at `rate`, rounded down (the user never gets promised more). */
export function usdtToFiatMinor(usdtUnits: bigint, rate: string): bigint {
  return (usdtUnits * parseRate(rate) * FIAT_MINOR) / (USDT_SCALE * RATE_SCALE)
}

/** Fiat minor units → the USDT base units needed to deliver at least that much, rounded up. */
export function fiatMinorToUsdt(fiatMinor: bigint, rate: string): bigint {
  return ceilDiv(fiatMinor * USDT_SCALE * RATE_SCALE, parseRate(rate) * FIAT_MINOR)
}

/** Parse a user-entered fiat amount ("27,090.50" is not accepted; "27090.50" is) to minor units. */
export const parseFiatMinor = (value: string): bigint => parseUnits(value, 2)

export const fiatMinorToDecimal = (minor: bigint): string => {
  const whole = minor / FIAT_MINOR
  const cents = (minor % FIAT_MINOR).toString().padStart(2, '0')
  return `${whole}.${cents}`
}

/** Ferry's fee in USDT base units: `bps` basis points of the amount, rounded up to a base unit. */
export function ferryFeeUnits(amountUnits: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0)
    throw new MoneyFormatError('Fee must be whole basis points')
  return ceilDiv(amountUnits * BigInt(bps), 10_000n)
}

export interface QuoteInput {
  amountIn: 'usdt' | 'fiat'
  /** Decimal string in the chosen unit. */
  amount: string
  rate: string
  feeBps: number
}

export interface QuoteAmounts {
  /** USDT converted to fiat (what Paycrest calls `amount`). */
  amountUnits: bigint
  ferryFeeUnits: bigint
  /** What leaves the user's wallet, before any provider transaction fee. */
  youSendUnits: bigint
  theyReceiveMinor: bigint
}

export function computeQuote(input: QuoteInput): QuoteAmounts {
  const amountUnits =
    input.amountIn === 'usdt'
      ? parseUnits(input.amount, USDT_DECIMALS)
      : fiatMinorToUsdt(parseFiatMinor(input.amount), input.rate)
  const fee = ferryFeeUnits(amountUnits, input.feeBps)
  return {
    amountUnits,
    ferryFeeUnits: fee,
    youSendUnits: amountUnits + fee,
    theyReceiveMinor: usdtToFiatMinor(amountUnits, input.rate),
  }
}

/** Percent-of-amount fee as basis points: "0.5" → 50. */
export function percentToBps(percent: string): number {
  return Number(parseUnits(percent, 2))
}

/** The largest amount whose amount + Ferry fee fits in `balanceUnits` ("Use max"). */
export function maxAmountForBalance(balanceUnits: bigint, bps: number): bigint {
  if (balanceUnits <= 0n) return 0n
  let amount = (balanceUnits * 10_000n) / (10_000n + BigInt(bps))
  while (amount > 0n && amount + ferryFeeUnits(amount, bps) > balanceUnits) amount -= 1n
  return amount
}
