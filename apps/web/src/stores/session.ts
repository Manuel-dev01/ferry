import type { BalancesResponse, MetaResponse } from '@ferry/shared'
import { lunaFromNumber } from '@ferry/shared'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Address } from 'viem'
import { api } from '../lib/api'
import {
  classifyEvmError,
  hasEvmProvider,
  requestAccount,
  type EvmErrorKind,
} from '../providers/evm'
import { readHostContext } from '../providers/host'
import { initNimiq, type NimiqProvider } from '../providers/nimiq'

export type ProviderStatus = 'loading' | 'ready' | 'outside'

/** If Nimiq Pay hasn't shown up by now, show the "open in Nimiq Pay" state while init keeps waiting. */
const OUTSIDE_HINT_MS = 1_500

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

  /** Never opens an approval dialog: init only waits for the provider to be injected. */
  async function start() {
    const hint = setTimeout(() => {
      if (status.value === 'loading' && !host.inHost) status.value = 'outside'
    }, OUTSIDE_HINT_MS)
    void loadMeta()
    try {
      nimiq.value = await initNimiq()
      status.value = 'ready'
    } catch {
      status.value = 'outside'
    } finally {
      clearTimeout(hint)
    }
  }

  async function loadMeta() {
    try {
      meta.value = await api<MetaResponse>('/v1/meta')
    } catch {
      meta.value = null // screens fall back to built-in defaults
    }
  }

  async function loadBalances() {
    if (!evmAddress.value) return
    balancesError.value = false
    try {
      if (import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true') {
        const { MOCK_BALANCES } = await import('../dev/mockWallet')
        balances.value = { usdt: MOCK_BALANCES.usdt, pol: MOCK_BALANCES.pol }
        return
      }
      const res = await api<BalancesResponse>(`/v1/balances/${evmAddress.value}`)
      balances.value = { usdt: BigInt(res.usdt), pol: BigInt(res.pol) }
    } catch (err) {
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
    loadNimBalance,
    canReadNimBalance,
  }
})
