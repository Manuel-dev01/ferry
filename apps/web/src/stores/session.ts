import type { BalancesResponse, MetaResponse } from '@ferry/shared'
import { lunaFromNumber } from '@ferry/shared'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Address } from 'viem'
import { api } from '../lib/api'
import {
  classifyEvmError,
  currentAccount,
  hasEvmProvider,
  requestAccount,
  type EvmErrorKind,
} from '../providers/evm'
import { readHostContext } from '../providers/host'
import { initNimiq, type NimiqProvider } from '../providers/nimiq'

export type ProviderStatus = 'loading' | 'ready' | 'outside'

export const useSessionStore = defineStore('session', () => {
  const host = readHostContext()
  const status = ref<ProviderStatus>('loading')
  const nimiq = shallowRef<NimiqProvider | null>(null)
  const meta = ref<MetaResponse | null>(null)

  const evmAddress = ref<Address | null>(null)
  const balances = ref<{ usdt: bigint; pol: bigint } | null>(null)
  const balancesError = ref(false)

  const nimAddress = ref<string | null>(null)
  const nimBalance = ref<bigint | null>(null)

  /**
   * Never opens an approval dialog: init only waits for the provider to be injected.
   * Without Nimiq Pay's host context we're in a normal browser, so the landing page shows
   * straight away; if a provider still turns up (older hosts), the app takes over.
   */
  async function start() {
    if (!host.inHost) status.value = 'outside'
    void loadMeta()
    try {
      nimiq.value = await initNimiq()
      status.value = 'ready'
      void restoreEvm()
    } catch {
      status.value = 'outside'
    }
  }

  /** Picks up an account the user already connected, without asking again. */
  async function restoreEvm() {
    if (!hasEvmProvider() || evmAddress.value) return
    try {
      const address = await currentAccount()
      if (!address) return
      evmAddress.value = address
      await loadBalances().catch(() => undefined)
    } catch {
      // not connected yet: Home shows the connect button
    }
  }

  /** Retries a few times: without meta the gas top-up is skipped. Screens assume Fonbnk. */
  async function loadMeta(attempt = 0): Promise<void> {
    try {
      meta.value = await api<MetaResponse>('/v1/meta')
    } catch {
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt))
        return loadMeta(attempt + 1)
      }
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !meta.value) void loadMeta()
    })
  }

  let balanceSequence = 0
  async function loadBalances() {
    const sequence = ++balanceSequence
    const address = evmAddress.value
    if (!address) return
    balancesError.value = false
    try {
      if (import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true') {
        const { MOCK_BALANCES } = await import('../dev/mockWallet')
        if (evmAddress.value === address && sequence === balanceSequence)
          balances.value = { usdt: MOCK_BALANCES.usdt, pol: MOCK_BALANCES.pol }
        return
      }
      const res = await api<BalancesResponse>(`/v1/balances/${address}`)
      if (evmAddress.value !== address || sequence !== balanceSequence) return
      balances.value = { usdt: BigInt(res.usdt), pol: BigInt(res.pol) }
    } catch (err) {
      if (evmAddress.value !== address || sequence !== balanceSequence) return
      balancesError.value = true
      throw err
    }
  }

  /** Approval 1 of a cash-out. Only ever call this from a deliberate tap. */
  async function connectEvm(): Promise<'ok' | EvmErrorKind> {
    if (!hasEvmProvider()) return 'unavailable'
    try {
      evmAddress.value = await requestAccount()
    } catch (err) {
      return classifyEvmError(err)
    }
    await loadBalances().catch(() => undefined) // shown via balancesError
    return 'ok'
  }

  /** Forget the EVM address on this device. Nimiq Pay keeps its own permission. */
  function disconnectEvm() {
    balanceSequence++
    evmAddress.value = null
    balances.value = null
    balancesError.value = false
  }

  async function loadNimBalance() {
    const provider = nimiq.value
    if (!provider || !nimAddress.value) return
    nimBalance.value = lunaFromNumber(await provider.getBalance(nimAddress.value))
  }

  const canReadNimBalance = () => typeof nimiq.value?.getBalance === 'function'

  return {
    host,
    status,
    nimiq,
    meta,
    evmAddress,
    balances,
    balancesError,
    nimAddress,
    nimBalance,
    start,
    loadBalances,
    connectEvm,
    disconnectEvm,
    loadNimBalance,
    canReadNimBalance,
  }
})
