import type { CorridorCurrency } from '@ferry/shared'
import type { Hex } from 'viem'

/** A test order remembered on this device, so leaving the page never loses track of it. */
export interface S5Order {
  tx: Hex
  at: number
  currency: CorridorCurrency
  amountUnits: string
  theyReceiveMinor: string
  accountName: string
  institutionName: string
  stage: string
}

const KEY = 'ferry.s5.orders'
const MAX = 20
export const TERMINAL_STAGES = ['settled', 'refunded', 'reverted', 'no_order']

export function loadS5Orders(): S5Order[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as S5Order[]) : []
  } catch {
    return []
  }
}

export function saveS5Order(order: S5Order): S5Order[] {
  const list = [order, ...loadS5Orders().filter((o) => o.tx !== order.tx)].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage blocked: the order still shows for this visit
  }
  return list
}
