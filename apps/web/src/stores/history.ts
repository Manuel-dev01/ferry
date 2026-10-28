import { recordCountry, type OrderView } from '@ferry/shared'
import { channelLabel } from '../lib/fonbnk'
import { fiatDisplay, usdtDisplay } from '../lib/format'
import { titleCase } from '../lib/names'
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
  /** A top-up (USDT bought through the partner) or a NIM → USDT swap, into the user's wallet. */
  kind?: 'topup' | 'nim'
  txHash?: string
  /** ISO 3166 code for partner cash-outs and top-ups; older entries only have `currency`. */
  country?: string
  amountUnits?: string
  channel?: string
  /** When the user confirmed the money arrived (partner payouts report no status to Ferry). */
  paidAt?: number
}

/** The amount a history row shows: fiat for Ferry orders, USDT sent for partner cash-outs. */
export const entryAmount = (e: HistoryEntry) =>
  e.kind === 'topup' || e.kind === 'nim'
    ? `+${usdtDisplay(BigInt(e.amountUnits ?? '0'))} USDT`
    : e.provider === 'fonbnk'
      ? `${usdtDisplay(BigInt(e.amountUnits ?? '0'))} USDT`
      : fiatDisplay(e.theyReceiveMinor, e.currency)

/** A history row's title: who was paid, or what happened. */
export function entryTitle(
  e: HistoryEntry,
  t: (key: string, values?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
) {
  if (e.kind === 'topup') return t('history.topupTitle')
  if (e.kind === 'nim') return t('history.nimTitle')
  if (e.provider === 'fonbnk') {
    const method = channelLabel(t, te, recordCountry(e) ?? '', e.channel ?? '')
    return t('history.cashoutTitle', { method })
  }
  return e.recipientName ? titleCase(e.recipientName) : e.institutionName
}

/** Where a history row opens. */
export const entryLink = (e: HistoryEntry) =>
  e.kind === 'topup'
    ? `/topup?id=${e.id}`
    : e.kind === 'nim'
      ? `/nim?swap=${e.id}`
      : e.provider === 'fonbnk' && e.txHash
        ? `/cashout/fonbnk?tx=${e.txHash}`
        : `/orders/${e.id}`

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

  /** The user says the partner's payout reached them. */
  function markPaid(id: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry && entry.status !== 'settled') {
      entry.status = 'settled'
      entry.paidAt = Date.now()
      persist()
    }
  }

  return { entries, add, updateFrom, find, setStatus, markPaid }
})
