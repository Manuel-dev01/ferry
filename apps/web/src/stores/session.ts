import type { BalancesResponse } from '@ferry/shared'
import { lunaFromNumber } from '@ferry/shared'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { Address } from 'viem'
import { api } from '../lib/api'
import { readHostContext } from '../providers/host'
import { initNimiq, type NimiqProvider } from '../providers/nimiq'

export type ProviderStatus = 'loading' | 'ready' | 'outside'

/** If Nimiq Pay hasn't shown up by now, show the "open in Nimiq Pay" state while init keeps waiting. */
const OUTSIDE_HINT_MS = 1_500

export const useSessionStore = defineStore('session', () => {
  const host = readHostContext()
  const status = ref<ProviderStatus>('loading')
  const nimiq = shallowRef<NimiqProvider | null>(null)

  const evmAddress = ref<Address | null>(null)
  const balances = ref<{ usdt: bigint; pol: bigint } | null>(null)

  const nimAddress = ref<string | null>(null)
  const nimBalance = ref<bigint | null>(null)

  /** Never opens an approval dialog: init only waits for the provider to be injected. */
  async function start() {
    const hint = setTimeout(() => {
      if (status.value === 'loading' && !host.inHost) status.value = 'outside'
    }, OUTSIDE_HINT_MS)
    try {
      nimiq.value = await initNimiq()
      status.value = 'ready'
    } catch {
      status.value = 'outside'
    } finally {
      clearTimeout(hint)
    }
  }

  async function loadBalances() {
    if (!evmAddress.value) return
    const res = await api<BalancesResponse>(`/v1/balances/${evmAddress.value}`)
    balances.value = { usdt: BigInt(res.usdt), pol: BigInt(res.pol) }
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
    evmAddress,
    balances,
    nimAddress,
    nimBalance,
    start,
    loadBalances,
    loadNimBalance,
    canReadNimBalance,
  }
})
