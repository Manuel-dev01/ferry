import {
  CORRIDORS,
  isCorridorCurrency,
  type CorridorCurrency,
  type CreateOfframpResponse,
  type Institution,
} from '@ferry/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type AmountIn = 'usdt' | 'fiat'

/** The cash-out being drafted. Account details live only in memory, never in storage. */
export const useCashoutStore = defineStore('cashout', () => {
  const recipientKind = ref<'self' | 'other'>('self')
  const currency = ref<CorridorCurrency | null>(null)
  const institution = ref<Institution | null>(null)
  const accountInput = ref('')
  const accountIdentifier = ref<string | null>(null)
  const accountName = ref<string | null>(null)
  const accountMasked = ref<string | null>(null)
  const amountIn = ref<AmountIn>('fiat')
  const amountInput = ref('')
  /** An order created but not yet signed; reused if the user retries before it expires. */
  const pendingOrder = ref<CreateOfframpResponse | null>(null)

  function start(kind: 'self' | 'other', hostFiat: string | null) {
    reset()
    recipientKind.value = kind
    if (isCorridorCurrency(hostFiat)) currency.value = hostFiat
  }

  function setCurrency(c: CorridorCurrency) {
    if (currency.value !== c) {
      institution.value = null
      clearAccount()
    }
    currency.value = c
  }

  function setInstitution(i: Institution) {
    if (institution.value?.code !== i.code) clearAccount()
    institution.value = i
  }

  function clearAccount() {
    accountInput.value = ''
    accountIdentifier.value = null
    accountName.value = null
    accountMasked.value = null
    pendingOrder.value = null
  }

  function reset() {
    recipientKind.value = 'self'
    currency.value = null
    institution.value = null
    clearAccount()
    amountIn.value = 'fiat'
    amountInput.value = ''
  }

  const corridor = () => CORRIDORS.find((c) => c.currency === currency.value) ?? null

  return {
    recipientKind,
    currency,
    institution,
    accountInput,
    accountIdentifier,
    accountName,
    accountMasked,
    amountIn,
    amountInput,
    pendingOrder,
    start,
    setCurrency,
    setInstitution,
    clearAccount,
    reset,
    corridor,
  }
})
