import {
  isCorridorCurrency,
  type CorridorCurrency,
  type FonbnkChannel,
  type StatsResponse,
} from '@ferry/shared'
import { getAddress, type Hex } from 'viem'

export interface ProofRow {
  txHash: string
  fromAddress: string
  amountUnits: bigint
  currency: string
  channel: string
  createdAt: Date
  receivedAt: Date | null
}

const LATEST = 20
// Longer than any real payout takes; a later "it arrived" tap says nothing about speed.
const MAX_CONFIRM_SECONDS = 2 * 24 * 60 * 60

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

const secondsToConfirm = (row: ProofRow) => {
  if (!row.receivedAt) return null
  const s = Math.round((row.receivedAt.getTime() - row.createdAt.getTime()) / 1000)
  return s >= 0 && s <= MAX_CONFIRM_SECONDS ? s : null
}

/** Proof of Ferry from the on-chain hand-off records, leaving out the builder's own wallets. */
export function computeStats(rows: ProofRow[], exclude: string[], now = Date.now()): StatsResponse {
  const skip = new Set(exclude.map((a) => getAddress(a)))
  const counted = rows
    .filter((r) => !skip.has(getAddress(r.fromAddress)) && isCorridorCurrency(r.currency))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const byCountry = new Map<CorridorCurrency, { cashouts: number; volume: bigint }>()
  let volume = 0n
  const seconds: number[] = []
  for (const r of counted) {
    const currency = r.currency as CorridorCurrency
    const c = byCountry.get(currency) ?? { cashouts: 0, volume: 0n }
    c.cashouts += 1
    c.volume += r.amountUnits
    byCountry.set(currency, c)
    volume += r.amountUnits
    const s = secondsToConfirm(r)
    if (s !== null) seconds.push(s)
  }

  return {
    cashouts: counted.length,
    confirmedPaid: counted.filter((r) => r.receivedAt).length,
    uniqueWallets: new Set(counted.map((r) => getAddress(r.fromAddress))).size,
    countries: byCountry.size,
    volumeUnits: volume.toString(),
    medianSeconds: median(seconds),
    byCountry: [...byCountry]
      .map(([currency, c]) => ({
        currency,
        cashouts: c.cashouts,
        volumeUnits: c.volume.toString(),
      }))
      .sort((a, b) => b.cashouts - a.cashouts),
    latest: counted.slice(0, LATEST).map((r) => ({
      currency: r.currency as CorridorCurrency,
      channel: r.channel as FonbnkChannel,
      amountUnits: r.amountUnits.toString(),
      txHash: r.txHash as Hex,
      at: r.createdAt.getTime(),
      seconds: secondsToConfirm(r),
    })),
    updatedAt: now,
  }
}
