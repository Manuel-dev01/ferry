import { describe, expect, it } from 'vitest'
import {
  countryFromLegacyCurrency,
  FONBNK_AIRTIME_COUNTRIES,
  FONBNK_COUNTRIES,
  FONBNK_COUNTRY_CODES,
  FONBNK_TOPUP_COUNTRIES,
  fonbnkOfframpUrl,
  fonbnkOnrampUrl,
  fonbnkPayoutChannels,
  handoffRequestSchema,
  type FonbnkCountryInfo,
  isFonbnkCountry,
  parseUsdt,
  recordCountry,
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
      fonbnkOfframpUrl({ country: 'NG', channel: 'bank', amountUnits: parseUsdt('4.5') }),
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
        country: 'GM',
        channel: 'mobile_money',
        amountUnits: parseUsdt('2'),
        callbackUrl: 'https://ferry-beta.vercel.app/fonbnk/return',
      }),
    )
    expect(params.countryIsoCode).toBe('GM')
    expect(params.callbackUrl).toBe('https://ferry-beta.vercel.app/fonbnk/return')
    expect(params.callbackBtnText).toBe('Back to Ferry')
    for (const p of ['source', 'signature', 'address', 'freezeWallet']) {
      expect(p in params).toBe(false)
    }
  })
})

describe('fonbnkOnrampUrl', () => {
  it('builds a public Polygon USDT buy link with no merchant-only parameter', () => {
    const { base, params } = parse(fonbnkOnrampUrl({ country: 'KE', channel: 'mobile_money' }))
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
})

describe('Fonbnk countries', () => {
  it('each has a cash-out route and a minimum', () => {
    for (const c of FONBNK_COUNTRY_CODES) {
      expect(FONBNK_COUNTRIES[c].cashout.length).toBeGreaterThan(0)
      expect(parseUsdt(FONBNK_COUNTRIES[c].minUsdt)).toBeGreaterThan(0n)
    }
  })

  it('keeps two countries that share a currency apart', () => {
    expect(FONBNK_COUNTRIES.SN.currency).toBe(FONBNK_COUNTRIES.CI.currency)
    expect(isFonbnkCountry('SN') && isFonbnkCountry('CI')).toBe(true)
    expect(isFonbnkCountry('XX')).toBe(false)
    expect(isFonbnkCountry('toString')).toBe(false)
  })

  it('sells airtime only where Fonbnk does, within its caps', () => {
    expect(FONBNK_AIRTIME_COUNTRIES).toContain('NG')
    expect(FONBNK_AIRTIME_COUNTRIES).not.toContain('GM')
    expect(fonbnkPayoutChannels('NG')).toEqual(['bank', 'airtime'])
    expect(fonbnkPayoutChannels('GM')).toEqual(['mobile_money'])
    for (const c of FONBNK_AIRTIME_COUNTRIES) {
      const a = (FONBNK_COUNTRIES[c] as FonbnkCountryInfo).airtime!
      expect(parseUsdt(a.maxUsdt)).toBeGreaterThan(parseUsdt(a.minUsdt))
    }
  })

  it('offers top-ups only where a route exists', () => {
    expect(FONBNK_TOPUP_COUNTRIES).toContain('NG')
    expect(FONBNK_TOPUP_COUNTRIES).not.toContain('GM')
  })

  it('reads old currency-only records', () => {
    expect(countryFromLegacyCurrency('KES')).toBe('KE')
    expect(countryFromLegacyCurrency('XOF')).toBeNull()
    expect(recordCountry({ currency: 'NGN' })).toBe('NG')
    expect(recordCountry({ country: 'GH', currency: 'GHS' })).toBe('GH')
  })
})

describe('handoffRequestSchema', () => {
  const base = { txHash: `0x${'a'.repeat(64)}`, provider: 'fonbnk', channel: 'mobile_money' }

  it('takes a country, or the older currency-only form', () => {
    expect(handoffRequestSchema.safeParse({ ...base, country: 'GM' }).success).toBe(true)
    expect(handoffRequestSchema.safeParse({ ...base, currency: 'KES' }).success).toBe(true)
  })

  it('needs one of them', () => {
    expect(handoffRequestSchema.safeParse(base).success).toBe(false)
  })
})
