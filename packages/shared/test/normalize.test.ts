import { describe, expect, it } from 'vitest'
import {
  formatKenyanPhoneLocal,
  normalizeKenyanPhone,
  normalizeNuban,
  shortAddress,
} from '../src/normalize'

describe('normalizeKenyanPhone', () => {
  it('accepts the common Kenyan forms', () => {
    for (const input of [
      '0712345678',
      '712345678',
      '254712345678',
      '+254 712 345 678',
      '0712-345-678',
    ]) {
      expect(normalizeKenyanPhone(input)).toBe('254712345678')
    }
    expect(normalizeKenyanPhone('0112345678')).toBe('254112345678')
  })

  it('rejects other numbers', () => {
    for (const input of ['', '0812345678', '07123456', '07123456789', '+234 803 000 0000', 'abc']) {
      expect(normalizeKenyanPhone(input)).toBeNull()
    }
  })

  it('formats for display', () => {
    expect(formatKenyanPhoneLocal('254712345678')).toBe('0712 345 678')
  })
})

describe('normalizeNuban', () => {
  it('accepts exactly 10 digits', () => {
    expect(normalizeNuban('0123456789')).toBe('0123456789')
    expect(normalizeNuban('012 345 6789')).toBe('0123456789')
    expect(normalizeNuban('012345678')).toBeNull()
    expect(normalizeNuban('01234567890')).toBeNull()
  })
})

describe('shortAddress', () => {
  it('shortens long addresses', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678')
    expect(shortAddress('0x12')).toBe('0x12')
  })
})
