import type { CorridorCurrency } from './constants'
import { normalizeNuban } from './normalize'

export type InstitutionType = 'bank' | 'mobile_money'
export type AccountKind = 'nuban' | 'phone' | 'account'

interface PhonePlan {
  dialCode: string
  /** National significant number pattern, after the leading 0 or dial code. */
  nsn: RegExp
  example: string
}

const PHONE_PLANS: Record<Exclude<CorridorCurrency, 'NGN'>, PhonePlan> = {
  KES: { dialCode: '254', nsn: /^[17]\d{8}$/, example: '0712 345 678' },
  UGX: { dialCode: '256', nsn: /^7\d{8}$/, example: '0772 123 456' },
  TZS: { dialCode: '255', nsn: /^[67]\d{8}$/, example: '0712 345 678' },
}

/** Mobile numbers in international form without "+": 254712345678. */
export function normalizePhone(currency: Exclude<CorridorCurrency, 'NGN'>, input: string) {
  const plan = PHONE_PLANS[currency]
  const digits = input.replace(/[\s\-().]/g, '').replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  let nsn: string
  if (digits.startsWith(plan.dialCode)) nsn = digits.slice(plan.dialCode.length)
  else if (digits.startsWith('0')) nsn = digits.slice(1)
  else nsn = digits
  return plan.nsn.test(nsn) ? `${plan.dialCode}${nsn}` : null
}

export function accountKind(currency: CorridorCurrency, type: InstitutionType): AccountKind {
  if (currency === 'NGN') return 'nuban'
  return type === 'mobile_money' ? 'phone' : 'account'
}

export function phoneExample(currency: CorridorCurrency): string {
  return currency === 'NGN' ? '' : PHONE_PLANS[currency].example
}

/** Normalizes what the user typed, or returns null when it can't be a valid identifier. */
export function normalizeAccountIdentifier(
  currency: CorridorCurrency,
  type: InstitutionType,
  input: string,
): string | null {
  switch (accountKind(currency, type)) {
    case 'nuban':
      return normalizeNuban(input)
    case 'phone':
      return normalizePhone(currency as Exclude<CorridorCurrency, 'NGN'>, input)
    case 'account': {
      const compact = input.replace(/[\s-]/g, '')
      return /^[0-9A-Za-z]{5,24}$/.test(compact) ? compact : null
    }
  }
}

/** "••••6789" */
export function maskAccount(identifier: string): string {
  return `••••${identifier.slice(-4)}`
}

/** "ADA OBI" → "A** O**" */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => `${part[0] ?? ''}**`)
    .join(' ')
}

/** Two-letter monogram for institutions and people, since we never show third-party logos. */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(of|the|and|bank|plc|ltd|limited)$/i.test(w))
  const first = words[0] ?? name
  const second = words[1]
  return (second ? `${first[0]}${second[0]}` : first.slice(0, 2)).toUpperCase()
}
