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
    session.nimAccounts = ['NQ-test-address']
    const request = session.loadNimBalance()
    session.disconnectEvm()
    complete(12900000)
    await request
    expect(session.nimBalance).toBeNull()
    expect(session.nimAccounts).toEqual([])
  })
  it('keeps zero distinct from an unavailable NIM balance', async () => {
    const session = useSessionStore()
    session.nimiq = { getBalance: async () => 0 } as unknown as NimiqProvider
    session.nimAccounts = ['NQ-test-address']
    await session.loadNimBalance()
    expect(session.nimBalance).toBe(0n)
    session.nimiq = {} as NimiqProvider
    await session.loadNimBalance()
    expect(session.nimBalance).toBeNull()
  })
  it('adds up the wallet address and the HTLC that holds the spendable NIM', async () => {
    const session = useSessionStore()
    const luna: Record<string, number> = { 'NQ84 WALLET': 0, 'NQ74 HTLC': 1_796_994_000 }
    session.nimiq = { getBalance: async (a: string) => luna[a] } as unknown as NimiqProvider
    session.nimAccounts = ['NQ84 WALLET', 'NQ74 HTLC']
    await session.loadNimBalance()
    expect(session.nimBalance).toBe(1_796_994_000n)
    luna['NQ84 WALLET'] = 500_000 // incoming NIM not yet moved into the HTLC still counts
    await session.loadNimBalance()
    expect(session.nimBalance).toBe(1_797_494_000n)
  })
  it('calls the total unavailable, not low, when one address cannot be read', async () => {
    const session = useSessionStore()
    session.nimiq = {
      getBalance: async (a: string) => {
        if (a === 'NQ74 HTLC') throw new Error('network')
        return 0
      },
    } as unknown as NimiqProvider
    session.nimAccounts = ['NQ84 WALLET', 'NQ74 HTLC']
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
