import { describe, expect, it } from 'vitest'
import {
  FONBNK_CHANNELS,
  FONBNK_MIN_USDT,
  FONBNK_ONRAMP_CHANNELS,
  fonbnkOfframpUrl,
  fonbnkOnrampUrl,
  parseUsdt,
} from '../src'

/** Splits a link into its base and decoded query, without relying on DOM or Node globals. */
function parse(link: string) {
  const [base = '', query = ''] = link.split('?')
  const params: Record<string, string> = {}
  for (const pair of query.split('&')) {
    const [k = '', v = ''] = pair.split('=')
    params[k] = decodeURIComponent(v)
  }
  return { base, params }
}

describe('fonbnkOfframpUrl', () => {
  it('builds a public Polygon USDT sell link with the amount locked', () => {
    const { base, params } = parse(
      fonbnkOfframpUrl({ currency: 'NGN', channel: 'bank', amountUnits: parseUsdt('4.5') }),
    )
    expect(base).toBe('https://pay.fonbnk.com/offramp')
    expect(params).toEqual({
      network: 'POLYGON',
      asset: 'USDT',
      currency: 'crypto',
      amount: '4.5',
      freezeAmount: 'true',
      hideSwitch: 'true',
      countryIsoCode: 'NG',
      paymentChannel: 'bank',
    })
  })

  it('adds a way back to Ferry and never a merchant-only parameter', () => {
    const { params } = parse(
      fonbnkOfframpUrl({
        currency: 'KES',
        channel: 'mobile_money',
        amountUnits: parseUsdt('1'),
        callbackUrl: 'https://ferry-beta.vercel.app/cashout/fonbnk',
      }),
    )
    expect(params.callbackUrl).toBe('https://ferry-beta.vercel.app/cashout/fonbnk')
    expect(params.callbackBtnText).toBe('Back to Ferry')
    for (const p of ['source', 'signature', 'address', 'freezeWallet']) {
      expect(p in params).toBe(false)
    }
  })

  it('covers every corridor', () => {
    for (const c of ['NGN', 'KES', 'UGX', 'TZS'] as const) {
      expect(FONBNK_CHANNELS[c].length).toBeGreaterThan(0)
      expect(parseUsdt(FONBNK_MIN_USDT[c])).toBeGreaterThan(0n)
    }
  })
})

describe('fonbnkOnrampUrl', () => {
  it('builds a public Polygon USDT buy link with no merchant-only parameter', () => {
    const { base, params } = parse(fonbnkOnrampUrl({ currency: 'KES', channel: 'mobile_money' }))
    expect(base).toBe('https://pay.fonbnk.com/')
    expect(params).toEqual({
      network: 'POLYGON',
      asset: 'USDT',
      currency: 'local',
      hideSwitch: 'true',
      countryIsoCode: 'KE',
      paymentChannel: 'mobile_money',
    })
  })

  it('offers a deposit route in every corridor', () => {
    for (const c of ['NGN', 'KES', 'UGX', 'TZS'] as const) {
      expect(FONBNK_ONRAMP_CHANNELS[c].length).toBeGreaterThan(0)
    }
  })
})
