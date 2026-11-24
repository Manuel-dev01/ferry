import { describe, expect, it } from 'vitest'
import { nimQuoteAmounts, nimSwapSdkAmount } from '../src/lib/nimSwap'

// Live read-only quote snapshot: base1667sats,fees13sats,actual estimate1680sats.
const quote = {
  source_amount: '1667',
  net_source_amount: '1680',
  min_amount: 356,
  max_amount: 20000000,
}
describe('NIM Lightning quote amounts', () => {
  it('shows the fee-inclusive invoice estimate rather than the pre-fee source', () => {
    expect(nimQuoteAmounts(quote)).toEqual({
      sats: 1680,
      feeSats: 13,
      minSats: 356,
      maxSats: 20000000,
    })
  })
  it('includes all fees represented in the authoritative net amount', () => {
    expect(nimQuoteAmounts({ ...quote, net_source_amount: '1690' }).feeSats).toBe(23)
  })
  it.each(['-1', '1.2', 'NaN', '1e3', '', '9007199254740992'])(
    'rejects invalid or inexact quoted sats %s',
    (net_source_amount) => {
      expect(() => nimQuoteAmounts({ ...quote, net_source_amount })).toThrow()
    },
  )
  it('rejects negative fees and broken limits', () => {
    expect(() => nimQuoteAmounts({ ...quote, net_source_amount: '1000' })).toThrow()
    expect(() => nimQuoteAmounts({ ...quote, min_amount: 1.1 })).toThrow()
    expect(() => nimQuoteAmounts({ ...quote, max_amount: 2 })).toThrow()
  })
  it('converts only exact positive base units at the SDK boundary', () => {
    expect(nimSwapSdkAmount(1000000n)).toBe(1000000)
    expect(nimSwapSdkAmount(9007199254740991n)).toBe(9007199254740991)
    expect(() => nimSwapSdkAmount(9007199254740992n)).toThrow()
    expect(() => nimSwapSdkAmount(0n)).toThrow()
  })
})
