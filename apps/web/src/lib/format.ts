import {
  fiatMinorToDecimal,
  formatUnitsFixed,
  NIM_DECIMALS,
  POL_DECIMALS,
  USDT_DECIMALS,
} from '@ferry/shared'

export const usdtDisplay = (units: bigint) => formatUnitsFixed(units, USDT_DECIMALS, 2)
export const polDisplay = (wei: bigint) => formatUnitsFixed(wei, POL_DECIMALS, 4)
export const nimDisplay = (luna: bigint) => {
  const [whole = '0', frac] = formatUnitsFixed(luna, NIM_DECIMALS, 2).split('.')
  return `${BigInt(whole).toLocaleString('en-US')}.${frac}`
}

const fiatFormatters = new Map<string, Intl.NumberFormat>()

/**
 * "₦27,061.00". Intl formats the decimal string directly, so no float is involved.
 * Whole-unit currencies (UGX, TZS) drop the cents.
 */
export function fiatDisplay(minor: bigint | string, currency: string, locale = 'en'): string {
  const key = `${locale}:${currency}`
  let fmt = fiatFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    })
    fiatFormatters.set(key, fmt)
  }
  const decimal = fiatMinorToDecimal(BigInt(minor))
  return fmt.format(decimal as unknown as number)
}

/** "1 USDT = ₦1,353.05" (rate truncated to two decimals for display). */
export const rateDisplay = (rate: string, currency: string) =>
  `1 USDT = ${fiatDisplay(rateToMinor(rate), currency)}`

function rateToMinor(rate: string): bigint {
  const [whole = '0', frac = ''] = rate.split('.')
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2))
}

export const polygonscanTx = (hash: string) => `https://polygonscan.com/tx/${hash}`

/** "28 s", "2 min 5 s" */
export function durationDisplay(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

export const timeDisplay = (at: number, locale = 'en') =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    at,
  )
