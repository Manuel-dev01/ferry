import type { OrderView } from '@ferry/shared'
import { fiatDisplay, usdtDisplay } from '../lib/format'
import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY = 'ferry.orders.v1'
const MAX_ENTRIES = 50

/** What this device remembers about an order. Stays on the device; never full account numbers. */
export interface HistoryEntry {
  id: string
  clientSecret: string
  createdAt: number
  currency: string
  institutionName: string
  recipientMasked: string
  recipientName: string | null // verified account name, kept on this device only
  theyReceiveMinor: string
  status: string
  mock: boolean
  /** Set for cash-outs a partner pays out: the user's own transfer to the partner. */
  provider?: 'fonbnk'
  txHash?: string
  amountUnits?: string
  channel?: string
}

/** The amount a history row shows: fiat for Ferry orders, USDT sent for partner cash-outs. */
export const entryAmount = (e: HistoryEntry) =>
  e.provider === 'fonbnk'
    ? `${usdtDisplay(BigInt(e.amountUnits ?? '0'))} USDT`
    : fiatDisplay(e.theyReceiveMinor, e.currency)

/** Where a history row opens. */
export const entryLink = (e: HistoryEntry) =>
  e.provider === 'fonbnk' && e.txHash ? `/cashout/fonbnk?tx=${e.txHash}` : `/orders/${e.id}`

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

  function setStatus(id: string, status: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry && entry.status !== status) {
      entry.status = status
      persist()
    }
  }

  return { entries, add, updateFrom, find, setStatus }
})
