import { describe, expect, it } from 'vitest'
import {
  computeQuote,
  ferryFeeUnits,
  fiatMinorToDecimal,
  fiatMinorToUsdt,
  parseRate,
  percentToBps,
  usdtToFiatMinor,
} from '../src/quote'

describe('rates', () => {
  it('parses and truncates excess precision', () => {
    expect(parseRate('1353.05')).toBe(1_353_050_000n)
    expect(parseRate('128.5712345678')).toBe(128_571_234n)
    expect(() => parseRate('0')).toThrow()
    expect(() => parseRate('abc')).toThrow()
  })

  it('converts USDT to fiat, rounding down', () => {
    // 20 USDT at 1353.05 = ₦27,061.00
    expect(usdtToFiatMinor(20_000_000n, '1353.05')).toBe(2_706_100n)
    // 0.000001 USDT is less than a kobo
    expect(usdtToFiatMinor(1n, '1353.05')).toBe(0n)
  })

  it('converts fiat to the USDT needed, rounding up so the recipient gets at least that', () => {
    const units = fiatMinorToUsdt(2_706_100n, '1353.05')
    expect(units).toBe(20_000_000n)
    const odd = fiatMinorToUsdt(1_000_000n, '1353.05') // ₦10,000
    expect(usdtToFiatMinor(odd, '1353.05')).toBeGreaterThanOrEqual(1_000_000n)
    expect(usdtToFiatMinor(odd - 1n, '1353.05')).toBeLessThan(1_000_000n)
  })

  it('formats minor units', () => {
    expect(fiatMinorToDecimal(2_706_100n)).toBe('27061.00')
    expect(fiatMinorToDecimal(5n)).toBe('0.05')
  })
})

describe('fees', () => {
  it('charges basis points, rounded up to a base unit', () => {
    expect(percentToBps('0.5')).toBe(50)
    expect(ferryFeeUnits(20_000_000n, 50)).toBe(100_000n) // 0.10 USDT
    expect(ferryFeeUnits(1n, 50)).toBe(1n)
    expect(ferryFeeUnits(20_000_000n, 0)).toBe(0n)
  })
})

describe('computeQuote', () => {
  it('quotes from a USDT amount', () => {
    expect(computeQuote({ amountIn: 'usdt', amount: '20', rate: '1353.05', feeBps: 50 })).toEqual({
      amountUnits: 20_000_000n,
      ferryFeeUnits: 100_000n,
      youSendUnits: 20_100_000n,
      theyReceiveMinor: 2_706_100n,
    })
  })

  it('quotes from a fiat amount', () => {
    const q = computeQuote({ amountIn: 'fiat', amount: '10000', rate: '1353.05', feeBps: 50 })
    expect(q.theyReceiveMinor).toBeGreaterThanOrEqual(1_000_000n)
    expect(q.youSendUnits).toBe(q.amountUnits + q.ferryFeeUnits)
  })
})

describe('maxAmountForBalance', () => {
  it('leaves room for the fee and never exceeds the balance', async () => {
    const { maxAmountForBalance } = await import('../src/quote')
    for (const balance of [0n, 1n, 2n, 1_000_000n, 125_500_000n, 200_000_001n]) {
      const amount = maxAmountForBalance(balance, 50)
      expect(amount + ferryFeeUnits(amount, 50)).toBeLessThanOrEqual(balance)
      expect(amount + 1n + ferryFeeUnits(amount + 1n, 50)).toBeGreaterThan(balance)
    }
  })
})
