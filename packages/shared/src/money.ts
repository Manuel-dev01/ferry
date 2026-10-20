// Token amounts are bigint base units. Fiat and user-entered amounts are decimal strings.
// Never route money through a JS number.

export const USDT_DECIMALS = 6
export const NIM_DECIMALS = 5 // 1 NIM = 100,000 Luna
export const POL_DECIMALS = 18

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/

export class MoneyFormatError extends Error {
  override name = 'MoneyFormatError'
}

/** Parse a non-negative decimal string ("12.5") into base units. Rejects excess precision. */
export function parseUnits(value: string, decimals: number): bigint {
  const match = DECIMAL_RE.exec(value.trim())
  if (!match) throw new MoneyFormatError(`Not a decimal amount: "${value}"`)
  const whole = match[1] ?? '0'
  const frac = match[2] ?? ''
  if (frac.length > decimals) {
    throw new MoneyFormatError(`Too many decimal places (max ${decimals}): "${value}"`)
  }
  return BigInt(whole + frac.padEnd(decimals, '0'))
}

/** Format base units as a decimal string, trimming trailing zeros ("1.5", "0", "-0.000001"). */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/** Format base units with a fixed number of display decimals, rounding down. */
export function formatUnitsFixed(value: bigint, decimals: number, display: number): string {
  if (display >= decimals) return formatUnits(value, decimals)
  const step = 10n ** BigInt(decimals - display)
  const truncated = (value / step) * step
  const [whole, frac = ''] = formatUnits(truncated, decimals).split('.')
  return display === 0 ? (whole ?? '0') : `${whole}.${frac.padEnd(display, '0')}`
}

export const parseUsdt = (value: string): bigint => parseUnits(value, USDT_DECIMALS)
export const formatUsdt = (value: bigint): string => formatUnits(value, USDT_DECIMALS)
export const formatNim = (luna: bigint): string => formatUnits(luna, NIM_DECIMALS)

/** The Nimiq provider returns balances as a JS number of Luna. Convert at the boundary. */
export function lunaFromNumber(luna: number): bigint {
  if (!Number.isSafeInteger(luna) || luna < 0) {
    throw new MoneyFormatError(`Invalid Luna amount: ${luna}`)
  }
  return BigInt(luna)
}
