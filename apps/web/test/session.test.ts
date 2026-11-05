import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../src/stores/session'
import type { NimiqProvider } from '../src/providers/nimiq'
const pending = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/lib/api', () => ({ api: pending.read }))
vi.mock('../src/providers/host', () => ({
  readHostContext: () => ({ language: 'en', fiat: 'NGN', network: 'mainnet', inHost: true }),
}))
vi.mock('../src/providers/nimiq', () => ({ initNimiq: vi.fn() }))
vi.mock('../src/providers/evm', () => ({
  classifyEvmError: vi.fn(),
  currentAccount: vi.fn(),
  hasEvmProvider: vi.fn(),
  requestAccount: vi.fn(),
}))
const address = '0x1111111111111111111111111111111111111111'
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubEnv('VITE_MOCK_WALLET', 'false')
  pending.read.mockReset()
})
describe('balance request isolation', () => {
  it('does not restore a disconnected NIM balance from a late read', async () => {
    let complete!: (value: number) => void
    const session = useSessionStore()
    session.nimiq = {
      getBalance: () => new Promise<number>((r) => (complete = r)),
    } as unknown as NimiqProvider
    session.nimAddress = 'NQ-test-address'
    const request = session.loadNimBalance()
    session.disconnectEvm()
    complete(12900000)
    await request
    expect(session.nimBalance).toBeNull()
    expect(session.nimAddress).toBeNull()
  })
  it('keeps zero distinct from an unavailable NIM balance', async () => {
    const session = useSessionStore()
    session.nimiq = { getBalance: async () => 0 } as unknown as NimiqProvider
    session.nimAddress = 'NQ-test-address'
    await session.loadNimBalance()
    expect(session.nimBalance).toBe(0n)
    session.nimiq = {} as NimiqProvider
    await session.loadNimBalance()
    expect(session.nimBalance).toBeNull()
  })
  it('keeps the latest balance when same-wallet reads finish out of order', async () => {
    let oldRead!: (value: unknown) => void
    pending.read
      .mockImplementationOnce(() => new Promise((r) => (oldRead = r)))
      .mockResolvedValueOnce({ usdt: '5000000', pol: '0' })
    const session = useSessionStore()
    session.evmAddress = address
    const stale = session.loadBalances()
    await session.loadBalances()
    oldRead({ usdt: '1000000', pol: '0' })
    await stale
    expect(session.balances?.usdt).toBe(5000000n)
  })

  it('does not restore a disconnected wallet with a late balance', async () => {
    let complete!: (value: unknown) => void
    pending.read.mockImplementation(() => new Promise((r) => (complete = r)))
    const session = useSessionStore()
    session.evmAddress = address
    const request = session.loadBalances()
    session.disconnectEvm()
    complete({ usdt: '4000000', pol: '0' })
    await request
    expect(session.evmAddress).toBeNull()
    expect(session.balances).toBeNull()
  })
  it('does not overwrite another wallet balance or error state', async () => {
    let fail!: (value: unknown) => void
    pending.read.mockImplementation(() => new Promise((_, reject) => (fail = reject)))
    const session = useSessionStore()
    session.evmAddress = address
    const request = session.loadBalances()
    session.evmAddress = '0x2222222222222222222222222222222222222222'
    session.balances = { usdt: 5000000n, pol: 0n }
    fail(new Error('old wallet read failed'))
    await request
    expect(session.balances.usdt).toBe(5000000n)
    expect(session.balancesError).toBe(false)
  })
})
