import { beforeEach, describe, expect, it, vi } from 'vitest'
let values: Record<string, string>
beforeEach(() => {
  vi.resetModules()
  values = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values[k] ?? null,
    setItem: (k: string, v: string) => {
      values[k] = v
    },
  })
})
const wallet = '0x1111111111111111111111111111111111111111'
describe('uncertain transfer recovery', () => {
  it('keeps an unknown transfer locked across a module reload until explicit clearing', async () => {
    let guard = await import('../src/lib/uncertainTransfers')
    guard.markUncertainTransfer(wallet)
    vi.resetModules()
    guard = await import('../src/lib/uncertainTransfers')
    expect(guard.hasUncertainTransfer(wallet)).toBe(true)
    expect(guard.hasUncertainTransfer('0x2222222222222222222222222222222222222222')).toBe(false)
    guard.clearUncertainTransfer(wallet)
    expect(guard.hasUncertainTransfer(wallet)).toBe(false)
  })
  it('handles damaged storage without crashing', async () => {
    values['ferry.uncertain-transfers.v1'] = '{broken'
    const guard = await import('../src/lib/uncertainTransfers')
    expect(guard.hasUncertainTransfer(wallet)).toBe(false)
    guard.markUncertainTransfer(wallet)
    expect(guard.hasUncertainTransfer(wallet)).toBe(true)
  })
  it('retains an in-memory guard when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    const guard = await import('../src/lib/uncertainTransfers')
    guard.markUncertainTransfer(wallet)
    expect(guard.hasUncertainTransfer(wallet)).toBe(true)
  })
})
