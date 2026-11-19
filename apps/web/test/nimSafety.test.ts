import { describe, expect, it } from 'vitest'
import { canStartNimPayment, nimPayDeadline, NIM_POLL_MAX_MS } from '../src/lib/nimSafety'
describe('NIM swap timing safety', () => {
  const swap = { claimBy: 1795109527, invoiceExpiresAt: 1795111327 }
  it('uses the actual earlier USDT claim deadline, not the later LN expiry', () => {
    expect(nimPayDeadline(swap)).toBe(1795109527)
    expect(canStartNimPayment(swap, 1795109527 + 1)).toBe(false)
    expect(canStartNimPayment(swap, 1795109527 - 300)).toBe(false)
    expect(canStartNimPayment(swap, 1795109527 - 301)).toBe(true)
  })
  it('accepts the original funding time but rejects absent or invalid deadline data', () => {
    expect(canStartNimPayment(swap, 1795105944)).toBe(true)
    expect(canStartNimPayment({ ...swap, claimBy: null }, 1)).toBe(false)
    expect(canStartNimPayment({ ...swap, invoiceExpiresAt: 0 }, 1)).toBe(false)
    expect(canStartNimPayment({ ...swap, claimBy: Number.NaN }, 1)).toBe(false)
  })
  it('keeps polling longer than the current 90-minute invoice window', () => {
    expect(NIM_POLL_MAX_MS).toBeGreaterThan(90 * 60_000)
  })
})
