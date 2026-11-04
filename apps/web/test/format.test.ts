import { describe, expect, it } from 'vitest'
import { lunaForUsdt, nimWholeDisplay } from '../src/lib/format'

describe('NIM hints', () => {
  it('converts USDT to Luna at a 10-decimal USD price', () => {
    // 5 USDT at $0.00024787 per NIM ≈ 20,171.86 NIM
    const luna = lunaForUsdt(5_000_000n, '0.0002478700')
    expect(luna).toBe(2_017_186_428n)
    expect(nimWholeDisplay(luna!)).toBe('20,172')
  })

  it('shows a meaningful small-wallet estimate without floating point money', () => {
    expect(nimWholeDisplay(lunaForUsdt(1_000_000n, '0.0020000000')!)).toBe('500')
  })
  it.each(['', 'unavailable', '-0.0020000000', '0.002', '1e-3'])(
    'ignores an unusable price %s',
    (price) => {
      expect(lunaForUsdt(1_000_000n, price)).toBeNull()
    },
  )
  it('gives nothing for a zero price', () => {
    expect(lunaForUsdt(5_000_000n, '0.0000000000')).toBeNull()
  })
})
