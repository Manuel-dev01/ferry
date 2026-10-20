import type { OrderView } from '@ferry/shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'ferry.orders.v1'
const MAX_ENTRIES = 50

/** What this device remembers about an order. No full account numbers or names. */
export interface HistoryEntry {
  id: string
  clientSecret: string
  createdAt: number
  currency: string
  institutionName: string
  recipientMasked: string
  recipientName: string | null // masked, e.g. "A** O**"
  theyReceiveMinor: string
  status: string
  mock: boolean
}

function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>(load())

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.value.slice(0, MAX_ENTRIES)))
    } catch {
      // storage unavailable (private mode): history lasts for this session only
    }
  }

  function add(entry: HistoryEntry) {
    entries.value = [entry, ...entries.value.filter((e) => e.id !== entry.id)]
    persist()
  }

  function updateFrom(order: OrderView) {
    const entry = entries.value.find((e) => e.id === order.id)
    if (entry && entry.status !== order.status) {
      entry.status = order.status
      persist()
    }
  }

  const find = (id: string) => entries.value.find((e) => e.id === id) ?? null

  return { entries, add, updateFrom, find }
})
