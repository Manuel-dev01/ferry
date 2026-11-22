import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ claim: vi.fn() }))
vi.mock('@lendasat/lendaswap-sdk-pure', () => ({
  IdbSwapStorage: class {},
  IdbWalletStorage: class {},
  Client: {
    builder: () => {
      const builder = {
        withSignerStorage: () => builder,
        withSwapStorage: () => builder,
        build: () => ({ claim: mock.claim }),
      }
      return builder
    },
  },
}))
import { allowNimClaimRetry, claimNimSwap } from '../src/lib/nimSwap'

describe('shared NIM claim submission', () => {
  it('shares a single submission between tracker and progress screen', async () => {
    mock.claim.mockResolvedValueOnce({ success: true, txHash: '0xclaim' })
    const a = claimNimSwap('same-swap')
    const b = claimNimSwap('same-swap')
    expect(a).toBe(b)
    expect(await a).toBe('0xclaim')
    await claimNimSwap('same-swap')
    expect(mock.claim).toHaveBeenCalledTimes(1)
  })

  it('keeps an ambiguous response locked until an explicit status-check action', async () => {
    mock.claim.mockRejectedValueOnce(new Error('offline'))
    await expect(claimNimSwap('retry-after-status-check')).rejects.toThrow('offline')
    await expect(claimNimSwap('retry-after-status-check')).rejects.toThrow('offline')
    allowNimClaimRetry('retry-after-status-check')
    mock.claim.mockResolvedValueOnce({ success: true, txHash: '0xrecovered' })
    expect(await claimNimSwap('retry-after-status-check')).toBe('0xrecovered')
  })
})
