import { formatUnits, USDT_DECIMALS } from './money'

/**
 * Fonbnk's hosted widget: the user verifies with Fonbnk and enters payout details there. For a
 * cash-out Ferry sends the USDT from the user's own wallet to the deposit address Fonbnk gives;
 * for a top-up Fonbnk sends USDT to the address the user pastes.
 */
export const FONBNK_WIDGET = {
  production: 'https://pay.fonbnk.com',
  sandbox: 'https://sandbox-pay.fonbnk.com',
} as const

export const FONBNK_HOSTS = ['pay.fonbnk.com', 'sandbox-pay.fonbnk.com'] as const

export type FonbnkChannel = 'bank' | 'mobile_money' | 'paybill' | 'buy_goods'

export interface FonbnkCountryInfo {
  /** ISO 4217 code of the payout currency. */
  currency: string
  name: string
  /** How a cash-out can be paid out (airtime left out on purpose). */
  cashout: readonly FonbnkChannel[]
  /** How a top-up can be paid in; empty where no route was confirmed. */
  topup: readonly FonbnkChannel[]
  /** Smallest cash-out Ferry offers, with headroom over Fonbnk's own floor for rate moves. */
  minUsdt: string
}

/**
 * Countries keyed by ISO 3166 code: two of them share XOF, so currency can't be the key. Routes
 * as Fonbnk's public order-limits API reported them on 2026-10-28.
 */
export const FONBNK_COUNTRIES = {
  NG: { currency: 'NGN', name: 'Nigeria', cashout: ['bank'], topup: ['bank'], minUsdt: '4' },
  KE: {
    currency: 'KES',
    name: 'Kenya',
    cashout: ['mobile_money', 'paybill', 'buy_goods', 'bank'],
    topup: ['mobile_money'],
    minUsdt: '1',
  },
  GH: {
    currency: 'GHS',
    name: 'Ghana',
    cashout: ['mobile_money'],
    topup: ['mobile_money'],
    minUsdt: '1.5',
  },
  ZA: { currency: 'ZAR', name: 'South Africa', cashout: ['bank'], topup: ['bank'], minUsdt: '1.5' },
  UG: {
    currency: 'UGX',
    name: 'Uganda',
    cashout: ['mobile_money'],
    topup: ['mobile_money'],
    minUsdt: '1',
  },
  TZ: {
    currency: 'TZS',
    name: 'Tanzania',
    cashout: ['mobile_money'],
    topup: ['mobile_money'],
    minUsdt: '1',
  },
  RW: { currency: 'RWF', name: 'Rwanda', cashout: ['mobile_money'], topup: [], minUsdt: '1.5' },
  ZM: { currency: 'ZMW', name: 'Zambia', cashout: ['mobile_money'], topup: [], minUsdt: '1.5' },
  GM: { currency: 'GMD', name: 'The Gambia', cashout: ['mobile_money'], topup: [], minUsdt: '1.5' },
  SN: { currency: 'XOF', name: 'Senegal', cashout: ['mobile_money'], topup: [], minUsdt: '1.5' },
  CI: {
    currency: 'XOF',
    name: 'Côte d’Ivoire',
    cashout: ['mobile_money'],
    topup: [],
    minUsdt: '1.5',
  },
  CM: { currency: 'XAF', name: 'Cameroon', cashout: ['mobile_money'], topup: [], minUsdt: '1.5' },
  BR: { currency: 'BRL', name: 'Brazil', cashout: ['bank'], topup: [], minUsdt: '1.5' },
} as const satisfies Record<string, FonbnkCountryInfo>

export type FonbnkCountry = keyof typeof FONBNK_COUNTRIES

/** In display order. */
export const FONBNK_COUNTRY_CODES = Object.keys(FONBNK_COUNTRIES) as FonbnkCountry[]

export const isFonbnkCountry = (value: unknown): value is FonbnkCountry =>
  typeof value === 'string' && Object.hasOwn(FONBNK_COUNTRIES, value)

export const fonbnkCountry = (country: FonbnkCountry): FonbnkCountryInfo =>
  FONBNK_COUNTRIES[country]

/** Countries where a top-up route was confirmed. */
export const FONBNK_TOPUP_COUNTRIES = FONBNK_COUNTRY_CODES.filter(
  (c) => FONBNK_COUNTRIES[c].topup.length > 0,
)

/** Records from before countries existed carry only one of the first four currencies. */
const LEGACY_CURRENCY_COUNTRY: Record<string, FonbnkCountry> = {
  NGN: 'NG',
  KES: 'KE',
  UGX: 'UG',
  TZS: 'TZ',
}
export const countryFromLegacyCurrency = (currency: string): FonbnkCountry | null =>
  LEGACY_CURRENCY_COUNTRY[currency] ?? null

/** The country an old (currency-only) or new record belongs to. */
export const recordCountry = (record: {
  country?: string | null
  currency?: string | null
}): FonbnkCountry | null =>
  isFonbnkCountry(record.country)
    ? record.country
    : record.currency
      ? countryFromLegacyCurrency(record.currency)
      : null

const query = (params: [string, string][]) =>
  params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

export interface FonbnkOfframpLink {
  country: FonbnkCountry
  channel: FonbnkChannel
  amountUnits: bigint
  callbackUrl?: string
  base?: string
}

/** A public sell link: no merchant key, amount locked so it matches what Ferry sends. */
export function fonbnkOfframpUrl(link: FonbnkOfframpLink): string {
  const params: [string, string][] = [
    ['network', 'POLYGON'],
    ['asset', 'USDT'],
    ['currency', 'crypto'],
    ['amount', formatUnits(link.amountUnits, USDT_DECIMALS)],
    ['freezeAmount', 'true'],
    ['hideSwitch', 'true'],
    ['countryIsoCode', link.country],
    ['paymentChannel', link.channel],
  ]
  if (link.callbackUrl) {
    params.push(['callbackUrl', link.callbackUrl], ['callbackBtnText', 'Back to Ferry'])
  }
  return `${link.base ?? FONBNK_WIDGET.production}/offramp?${query(params)}`
}

export interface FonbnkOnrampLink {
  country: FonbnkCountry
  channel: FonbnkChannel
  callbackUrl?: string
  base?: string
}

/**
 * A public buy link: USDT on Polygon, amount chosen in Fonbnk. Prefilling the wallet address needs
 * a verified merchant, so the user pastes their own address in Fonbnk.
 */
export function fonbnkOnrampUrl(link: FonbnkOnrampLink): string {
  const params: [string, string][] = [
    ['network', 'POLYGON'],
    ['asset', 'USDT'],
    ['currency', 'local'],
    ['hideSwitch', 'true'],
    ['countryIsoCode', link.country],
    ['paymentChannel', link.channel],
  ]
  if (link.callbackUrl) {
    params.push(['callbackUrl', link.callbackUrl], ['callbackBtnText', 'Back to Ferry'])
  }
  return `${link.base ?? FONBNK_WIDGET.production}/?${query(params)}`
}
