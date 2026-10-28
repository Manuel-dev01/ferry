import { describe, expect, it } from 'vitest'
import { computeStats, type ProofRow } from '../src/proof'
import { json, makeApp } from './helpers'

const BUILDER = '0x358bC84A34Df878A5497DFc01D14D6AaFe7E8A76'
const ALICE = '0x1111111254EEB25477B68fb85Ed929f73A960582'
const BOB = '0x2222222254eeb25477b68fb85ed929f73a960582'

const T0 = Date.UTC(2026, 9, 28, 12)
const row = (over: Partial<ProofRow>): ProofRow => ({
  txHash: `0x${'a'.repeat(64)}`,
  fromAddress: ALICE,
  amountUnits: 5_000_000n,
  currency: 'NGN',
  country: null,
  channel: 'bank',
  createdAt: new Date(T0),
  receivedAt: null,
  ...over,
})

describe('computeStats', () => {
  it('is all zeros with no cash-outs', () => {
    const s = computeStats([], [], T0)
    expect(s).toMatchObject({
      cashouts: 0,
      confirmedPaid: 0,
      uniqueWallets: 0,
      countries: 0,
      volumeUnits: '0',
      medianSeconds: null,
      byCountry: [],
      latest: [],
    })
  })

  it("counts cash-outs, wallets, countries and volume, leaving out the builder's wallets", () => {
    const s = computeStats(
      [
        row({ txHash: '0x01', fromAddress: ALICE }),
        row({
          txHash: '0x02',
          fromAddress: BOB,
          currency: 'GMD',
          country: 'GM',
          channel: 'mobile_money',
        }),
        row({ txHash: '0x03', fromAddress: ALICE.toLowerCase(), amountUnits: 1_500_000n }),
        row({ txHash: '0x04', fromAddress: BUILDER.toLowerCase(), amountUnits: 99_000_000n }),
      ],
      [BUILDER],
      T0,
    )
    expect(s.cashouts).toBe(3)
    expect(s.uniqueWallets).toBe(2)
    expect(s.countries).toBe(2)
    expect(s.volumeUnits).toBe('11500000')
    expect(s.byCountry[0]).toEqual({ country: 'NG', cashouts: 2, volumeUnits: '6500000' })
    expect(s.byCountry[1]?.country).toBe('GM')
    expect(s.latest.map((l) => l.txHash)).not.toContain('0x04')
  })

  it('takes the median over confirmed cash-outs and ignores implausible confirmations', () => {
    const at = (min: number) => new Date(T0 + min * 60_000)
    const s = computeStats(
      [
        row({ txHash: '0x01', receivedAt: at(4) }),
        row({ txHash: '0x02', receivedAt: at(10) }),
        row({ txHash: '0x03', receivedAt: at(6) }),
        row({ txHash: '0x04', receivedAt: at(60 * 24 * 5) }), // days later: counted, not timed
        row({ txHash: '0x05' }),
      ],
      [],
      T0,
    )
    expect(s.confirmedPaid).toBe(4)
    expect(s.medianSeconds).toBe(6 * 60)
  })

  it('lists the newest first, without wallet addresses', () => {
    const s = computeStats(
      [
        row({ txHash: '0x01', createdAt: new Date(T0) }),
        row({ txHash: '0x02', createdAt: new Date(T0 + 1000) }),
      ],
      [],
      T0,
    )
    expect(s.latest.map((l) => l.txHash)).toEqual(['0x02', '0x01'])
    expect(JSON.stringify(s)).not.toContain(ALICE.slice(2, 12))
  })
})

describe('Proof of Ferry endpoints', () => {
  it('says so when the database is unavailable', async () => {
    const res = await makeApp().request('/v1/stats')
    expect(res.status).toBe(503)
    expect((await json(res)).error.code).toBe('DB_UNAVAILABLE')
  })

  it('needs the database to record a confirmed payout', async () => {
    const res = await makeApp().request(`/v1/handoffs/0x${'b'.repeat(64)}/received`, {
      method: 'POST',
    })
    expect(res.status).toBe(503)
  })
})
