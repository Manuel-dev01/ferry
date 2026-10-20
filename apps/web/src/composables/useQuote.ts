import type { CorridorCurrency, QuoteResponse } from '@ferry/shared'
import { onUnmounted, ref, watch, type Ref } from 'vue'
import { errorCode, errorRef } from '../lib/api'
import { ferryApi } from '../lib/ferryApi'

const DEBOUNCE_MS = 350
const REFRESH_MS = 15_000
const AMOUNT_RE = /^\d+(\.\d+)?$/

export interface QuoteError {
  code: string
  ref?: string
}

/** Live quote for the amount being typed: debounced, and refreshed every 15 s. */
export function useQuote(
  currency: Ref<CorridorCurrency | null>,
  amount: Ref<string>,
  amountIn: Ref<'usdt' | 'fiat'>,
  refreshMs = REFRESH_MS,
) {
  const quote = ref<QuoteResponse | null>(null)
  const loading = ref(false)
  const error = ref<QuoteError | null>(null)
  let debounce: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  async function refresh() {
    const c = currency.value
    const a = amount.value
    if (!c || !AMOUNT_RE.test(a) || /^0+(\.0+)?$/.test(a)) {
      quote.value = null
      error.value = null
      return
    }
    const mine = ++seq
    loading.value = true
    try {
      const q = await ferryApi.quote(c, a, amountIn.value)
      if (mine === seq) {
        quote.value = q
        error.value = null
      }
    } catch (err) {
      if (mine === seq) {
        quote.value = null
        error.value = { code: errorCode(err) ?? 'UNKNOWN', ref: errorRef(err) }
      }
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  watch(
    [currency, amount, amountIn],
    () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => void refresh(), DEBOUNCE_MS)
    },
    { immediate: true },
  )
  const timer = setInterval(() => void refresh(), refreshMs)
  onUnmounted(() => {
    clearTimeout(debounce)
    clearInterval(timer)
  })

  return { quote, loading, error, refresh }
}
