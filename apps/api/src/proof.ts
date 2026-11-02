import {
  isFonbnkCountry,
  mpesaReceiptUrl,
  POLYGONSCAN_TX,
  recordCountry,
  type FonbnkChannel,
  type FonbnkCountry,
  type StatsResponse,
} from '@ferry/shared'
import { getAddress } from 'viem'

export interface ProofRow {
  txHash: string
  fromAddress: string
  amountUnits: bigint
  currency: string
  country: string | null
  channel: string
  createdAt: Date
  receivedAt: Date | null
}

/** An M-Pesa Direct payout Ferry issued the invoice for; it counts once delivered. */
export interface LnProofRow {
  paymentHash: string
  country: string
  channel: string
  amountUnits: bigint
  createdAt: Date
  deliveredAt: Date | null
  /** Seen live, so deliveredAt is a real delivery time and can feed the median. */
  timed: boolean
}

/** A NIM → USDT swap read back from LendaSwap and Polygon. */
export interface NimSwapRow {
  toAddress: string
  amountUnits: bigint
}

interface Counted {
  route: 'fonbnk' | 'mpesa_ln'
  country: FonbnkCountry
  channel: string
  amountUnits: bigint
  wallet: string | null
  link: string
  createdAt: Date
  doneAt: Date | null
  /** False when the finish time is only when Ferry happened to notice it. */
  timedDone?: boolean
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

const secondsToDone = (row: { createdAt: Date; doneAt: Date | null; timedDone?: boolean }) => {
  if (!row.doneAt || row.timedDone === false) return null
  const s = Math.round((row.doneAt.getTime() - row.createdAt.getTime()) / 1000)
  return s >= 0 && s <= MAX_CONFIRM_SECONDS ? s : null
}

/**
 * Proof of Ferry: Fonbnk hand-offs seen on-chain (minus the builder's wallets), plus M-Pesa
 * Direct payouts that Tando confirmed with an M-Pesa receipt. Unique wallets counts on-chain
 * senders only: a Lightning payout doesn't reveal the paying wallet.
 */
export function computeStats(
  rows: ProofRow[],
  exclude: string[],
  now = Date.now(),
  lnRows: LnProofRow[] = [],
  nimRows: NimSwapRow[] = [],
): StatsResponse {
  const skip = new Set(exclude.map((a) => getAddress(a)))
  const swaps = nimRows.filter((r) => !skip.has(getAddress(r.toAddress)))
  const fromChain: Counted[] = rows
    .filter((r) => !skip.has(getAddress(r.fromAddress)))
    .flatMap((r) => {
      const country = recordCountry(r)
      return country
        ? [
            {
              route: 'fonbnk' as const,
              country,
              channel: r.channel,
              amountUnits: r.amountUnits,
              wallet: getAddress(r.fromAddress),
              link: POLYGONSCAN_TX(r.txHash),
              createdAt: r.createdAt,
              doneAt: r.receivedAt,
            },
          ]
        : []
    })
  const fromLightning: Counted[] = lnRows.flatMap((r) =>
    r.deliveredAt && isFonbnkCountry(r.country)
      ? [
          {
            route: 'mpesa_ln' as const,
            country: r.country,
            channel: r.channel,
            amountUnits: r.amountUnits,
            wallet: null,
            link: mpesaReceiptUrl(r.paymentHash),
            createdAt: r.createdAt,
            doneAt: r.deliveredAt,
            timedDone: r.timed,
          },
        ]
      : [],
  )
  const counted = [...fromChain, ...fromLightning].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )

  const byCountry = new Map<FonbnkCountry, { cashouts: number; volume: bigint }>()
  let volume = 0n
  const seconds: number[] = []
  for (const r of counted) {
    const c = byCountry.get(r.country) ?? { cashouts: 0, volume: 0n }
    c.cashouts += 1
    c.volume += r.amountUnits
    byCountry.set(r.country, c)
    volume += r.amountUnits
    const s = secondsToDone(r)
    if (s !== null) seconds.push(s)
  }

  return {
    cashouts: counted.length,
    confirmedPaid: counted.filter((r) => r.doneAt).length,
    uniqueWallets: new Set(counted.flatMap((r) => (r.wallet ? [r.wallet] : []))).size,
    countries: byCountry.size,
    volumeUnits: volume.toString(),
    medianSeconds: median(seconds),
    nimSwaps: {
      count: swaps.length,
      volumeUnits: swaps.reduce((sum, r) => sum + r.amountUnits, 0n).toString(),
    },
    byCountry: [...byCountry]
      .map(([country, c]) => ({
        country,
        cashouts: c.cashouts,
        volumeUnits: c.volume.toString(),
      }))
      .sort((a, b) => b.cashouts - a.cashouts),
    latest: counted.slice(0, LATEST).map((r) => ({
      country: r.country,
      channel: r.channel as FonbnkChannel,
      amountUnits: r.amountUnits.toString(),
      route: r.route,
      link: r.link,
      at: r.createdAt.getTime(),
      seconds: secondsToDone(r),
    })),
    updatedAt: now,
  }
}
