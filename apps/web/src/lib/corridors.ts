import type { CorridorCurrency } from '@ferry/shared'

export const FLAGS: Record<CorridorCurrency, string> = {
  NGN: '🇳🇬',
  KES: '🇰🇪',
  UGX: '🇺🇬',
  TZS: '🇹🇿',
}

export const DIAL_CODES: Record<CorridorCurrency, string> = {
  NGN: '234',
  KES: '254',
  UGX: '256',
  TZS: '255',
}

export const COUNTRY_NAMES: Record<CorridorCurrency, string> = {
  NGN: 'Nigeria',
  KES: 'Kenya',
  UGX: 'Uganda',
  TZS: 'Tanzania',
}

const symbols = new Map<string, string>()

/** "₦", "KSh", "USh", "TSh" */
export function currencySymbol(currency: string): string {
  let s = symbols.get(currency)
  if (!s) {
    s =
      new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    symbols.set(currency, s)
  }
  return s
}
