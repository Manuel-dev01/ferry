import { isOfframpStatus, isTerminal, type OrderView } from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { errorCode } from '../lib/api'
import { ferryApi } from '../lib/ferryApi'
import { useHistoryStore } from '../stores/history'

const POLL_MS = 2_500

/** Follows an order this device created. Read-only: polling never resends anything. */
export function useOrder(id: () => string, poll = true) {
  const history = useHistoryStore()
  const entry = computed(() => history.find(id()))
  const order = ref<OrderView | null>(null)
  const offline = ref(false)
  const gone = ref(false)
  const lastUpdate = ref<number | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    const e = entry.value
    if (!e) return
    try {
      order.value = await ferryApi.order(e.id, e.clientSecret)
      history.updateFrom(order.value)
      offline.value = false
      lastUpdate.value = Date.now()
    } catch (err) {
      if (errorCode(err) === 'ORDER_NOT_FOUND') {
        gone.value = true // e.g. a dev API restart dropped its in-memory mock orders
        return
      }
      offline.value = true // a failed read is not an outcome; keep checking
    }
    const s = order.value?.status
    if (poll && (!s || !isOfframpStatus(s) || !isTerminal(s))) {
      timer = setTimeout(() => void load(), POLL_MS)
    }
  }

  onMounted(() => void load())
  onUnmounted(() => clearTimeout(timer))

  const status = computed(() => order.value?.status ?? entry.value?.status ?? 'submitted')
  /** First time each status was reached. */
  const at = computed(() => {
    const times: Record<string, number> = {}
    for (const t of order.value?.timeline ?? []) times[t.status] ??= t.at
    return times
  })

  return { entry, order, status, at, offline, gone, lastUpdate }
}
