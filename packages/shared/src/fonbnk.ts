import type { CorridorCurrency } from './constants'
import { formatUnits, USDT_DECIMALS } from './money'

/**
 * Fonbnk's hosted off-ramp: the user verifies with Fonbnk, enters payout details there, and gets
 * a deposit address. Ferry sends the USDT from the user's own wallet to that address.
 */
export const FONBNK_WIDGET = {
  production: 'https://pay.fonbnk.com',
  sandbox: 'https://sandbox-pay.fonbnk.com',
} as const

export const FONBNK_HOSTS = ['pay.fonbnk.com', 'sandbox-pay.fonbnk.com'] as const

export type FonbnkChannel = 'bank' | 'mobile_money' | 'paybill' | 'buy_goods'

/** Payout channels Fonbnk offers per corridor (airtime left out on purpose). */
export const FONBNK_CHANNELS: Record<CorridorCurrency, readonly FonbnkChannel[]> = {
  NGN: ['bank'],
  KES: ['mobile_money', 'paybill', 'buy_goods', 'bank'],
  UGX: ['mobile_money'],
  TZS: ['mobile_money'],
}

export const FONBNK_COUNTRY: Record<CorridorCurrency, string> = {
  NGN: 'NG',
  KES: 'KE',
  UGX: 'UG',
  TZS: 'TZ',
}

/**
 * Smallest USDT amount to offer per corridor. Fonbnk's own floor seen on 2026-10-28 was about
 * 3.64 USDT for Nigerian banks and under 1 USDT elsewhere; Nigeria gets headroom for rate moves.
 */
export const FONBNK_MIN_USDT: Record<CorridorCurrency, string> = {
  NGN: '4',
  KES: '1',
  UGX: '1',
  TZS: '1',
}

export interface FonbnkOfframpLink {
  currency: CorridorCurrency
  channel: FonbnkChannel
  amountUnits: bigint
  callbackUrl?: string
  base?: string
}

/** A public widget link: no merchant key, amount locked so it matches what Ferry sends. */
export function fonbnkOfframpUrl(link: FonbnkOfframpLink): string {
  const params: [string, string][] = [
    ['network', 'POLYGON'],
    ['asset', 'USDT'],
    ['currency', 'crypto'],
    ['amount', formatUnits(link.amountUnits, USDT_DECIMALS)],
    ['freezeAmount', 'true'],
    ['hideSwitch', 'true'],
    ['countryIsoCode', FONBNK_COUNTRY[link.currency]],
    ['paymentChannel', link.channel],
  ]
  if (link.callbackUrl) {
    params.push(['callbackUrl', link.callbackUrl], ['callbackBtnText', 'Back to Ferry'])
  }
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `${link.base ?? FONBNK_WIDGET.production}/offramp?${query}`
}
