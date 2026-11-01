import { describe, expect, it } from 'vitest'
import {
  afterSwapAllowance,
  fiatForSats,
  kesDelivered,
  kesForSats,
  kesToInvoice,
  msatForKes,
  priceToCents,
  rateFor,
  recommend,
  satsForUnits,
} from '../src/payouts'
import { json, makeApp } from './helpers'

describe('payout route math', () => {
  it('turns USDT into sats at a BTC price', () => {
    // 5 USDT at $80,000/BTC = 6,250 sats
    expect(satsForUnits(5_000_000n, priceToCents(80_000))).toBe(6_250n)
  })

  it('keeps a 1% allowance for the swap fee', () => {
    expect(afterSwapAllowance(10_000n)).toBe(9_900n)
  })

  it("covers Tando's cut so the asked shillings arrive", () => {
    for (const net of [15n, 20n, 50n, 100n, 1_000n, 5_000n, 49_000n]) {
      const gross = kesToInvoice(net)
      expect(kesDelivered(gross)).toBeGreaterThanOrEqual(net)
      expect(kesDelivered(gross - 1n)).toBeLessThan(net)
    }
    // Matches what Tando recorded: 1,000 invoiced, 989 delivered
    expect(kesDelivered(1_000n)).toBe(989n)
  })

  it('asks for whole sats when invoicing shillings', () => {
    expect(msatForKes(20n, 9_585n)).toBe(192_000n)
    expect(msatForKes(1n, 1_000n)).toBe(1_000n)
  })

  it("pays shillings at the M-Pesa address's msat multiplier", () => {
    // 9,585 msat per shilling: 6,250 sats = 652 shillings
    expect(kesForSats(6_250n, 9_585n)).toBe(652n)
  })

  it('pays local units at a price per BTC', () => {
    // ₦106,276,057.89 per BTC: 6,250 sats ≈ ₦6,642
    expect(fiatForSats(6_250n, priceToCents(106_276_057.89))).toBe(6_642n)
  })

  it('states the rate per USDT with two decimals', () => {
    expect(rateFor(652n, 5_000_000n)).toBe('130.40')
    expect(rateFor(0n, 0n)).toBe('0')
  })
})

describe('recommend', () => {
  const offer = (route: 'fonbnk' | 'mpesa_ln' | 'mavapay_ln', receive: string) => ({
    route,
    receive,
    currency: 'KES',
    rate: '0',
    fee: null,
    estimate: route !== 'fonbnk',
  })

  it('prefers the one-screen route unless the form pays over 3% more', () => {
    const close = recommend([offer('fonbnk', '623'), offer('mpesa_ln', '610')])
    expect(close[0]).toMatchObject({ route: 'mpesa_ln', recommended: true })
    const far = recommend([offer('fonbnk', '700'), offer('mpesa_ln', '610')])
    expect(far[0]).toMatchObject({ route: 'fonbnk', recommended: true })
    expect(far.filter((o) => o.recommended)).toHaveLength(1)
  })

  it('never favours Mavapay Money, which needs an account', () => {
    const r = recommend([offer('fonbnk', '6831'), offer('mavapay_ln', '6751')])
    expect(r[0]).toMatchObject({ route: 'fonbnk', recommended: true })
  })

  it('handles no offers', () => {
    expect(recommend([])).toEqual([])
  })
})

describe('payout endpoints', () => {
  it('rejects an offer request for an unknown country', async () => {
    const res = await makeApp().request('/v1/offers?country=XX&channel=bank&units=5000000')
    expect(res.status).toBe(400)
  })

  it('only fetches invoices for Mavapay Money addresses', async () => {
    const res = await makeApp().request('/v1/ln/mavapay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: 'someone@evil.example', units: '1000000' }),
    })
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe('INVALID_REQUEST')
  })

  it('rejects a phone number that is not Kenyan', async () => {
    const res = await makeApp().request('/v1/ln/mpesa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '08012345678', kes: 100 }),
    })
    expect(res.status).toBe(400)
  })
})
