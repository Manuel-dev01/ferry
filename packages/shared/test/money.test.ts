import { describe, expect, it } from 'vitest'
import {
  MoneyFormatError,
  formatUnits,
  formatUnitsFixed,
  formatUsdt,
  lunaFromNumber,
  parseUnits,
  parseUsdt,
} from '../src/money'

describe('parseUnits', () => {
  it('parses whole and fractional amounts', () => {
    expect(parseUsdt('1')).toBe(1_000_000n)
    expect(parseUsdt('0.5')).toBe(500_000n)
    expect(parseUsdt('12.345678')).toBe(12_345_678n)
    expect(parseUnits('0.00001', 5)).toBe(1n)
    expect(parseUsdt(' 20 ')).toBe(20_000_000n)
  })

  it('never goes through floating point', () => {
    expect(parseUsdt('0.1') + parseUsdt('0.2')).toBe(parseUsdt('0.3'))
    expect(parseUnits('123456789012345678.123456', 6)).toBe(123456789012345678123456n)
  })

  it('rejects malformed input and excess precision', () => {
    for (const bad of ['', '-1', '1e6', '1.', '.5', '1,000', 'abc', '0x10']) {
      expect(() => parseUsdt(bad)).toThrow(MoneyFormatError)
    }
    expect(() => parseUsdt('1.0000001')).toThrow(MoneyFormatError)
  })
})

describe('formatUnits', () => {
  it('trims trailing zeros', () => {
    expect(formatUsdt(1_000_000n)).toBe('1')
    expect(formatUsdt(1_500_000n)).toBe('1.5')
    expect(formatUsdt(1n)).toBe('0.000001')
    expect(formatUsdt(0n)).toBe('0')
    expect(formatUnits(-1n, 6)).toBe('-0.000001')
  })

  it('round-trips with parseUnits', () => {
    for (const v of ['0', '1', '0.000001', '199.99', '500']) {
      expect(formatUsdt(parseUsdt(v))).toBe(v)
    }
  })

  it('formats fixed display decimals, rounding down', () => {
    expect(formatUnitsFixed(12_345_678n, 6, 2)).toBe('12.34')
    expect(formatUnitsFixed(12_000_000n, 6, 2)).toBe('12.00')
    expect(formatUnitsFixed(999_999n, 6, 0)).toBe('0')
  })
})

describe('lunaFromNumber', () => {
  it('accepts safe non-negative integers only', () => {
    expect(lunaFromNumber(0)).toBe(0n)
    expect(lunaFromNumber(110_000_00000)).toBe(11_000_000_000n)
    expect(() => lunaFromNumber(1.5)).toThrow(MoneyFormatError)
    expect(() => lunaFromNumber(-1)).toThrow(MoneyFormatError)
    expect(() => lunaFromNumber(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyFormatError)
  })
})
