import type { MpesaStatusResponse } from '@ferry/shared'
import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { lnPayouts } from './db/schema'
import type { FetchLike } from './lightning'

const TIMEOUT_MS = 8_000
/** Tando statuses that mean the M-Pesa payout won't happen. */
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'expired', 'error', 'refunded'])
/** Unconfirmed M-Pesa Direct payouts are re-checked for this long, then left alone. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60_000

const tandoStatusSchema = z.object({
  success: z.boolean(),
  transaction: z
    .object({
      status: z.string(),
      isPaid: z.boolean().optional(),
      paymentNetworkReceipt: z.string().nullish(),
      currencyAmountSent: z.number().nullish(),
    })
    .nullish(),
})

/** Tando's public status for a Lightning payment to an M-Pesa address. */
export async function tandoStatus(
  fetchImpl: FetchLike,
  hash: string,
): Promise<MpesaStatusResponse> {
  // Tando being unreachable (DNS, timeout, bad JSON) is "unknown", never an error: callers poll.
  let body: unknown
  try {
    const res = await fetchImpl(
      `https://api.tando.ltd/v1/transactions/btcpay/payment-hash/${hash}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    )
    if (!res.ok) return { status: 'unknown', paid: false, receipt: null, kes: null }
    body = await res.json()
  } catch {
    return { status: 'unknown', paid: false, receipt: null, kes: null }
  }
  const parsed = tandoStatusSchema.safeParse(body)
  const tx = parsed.success ? parsed.data.transaction : null
  if (!tx) return { status: 'unknown', paid: false, receipt: null, kes: null }
  const done = tx.status === 'completed' && tx.isPaid === true
  const failed = FAILED_STATUSES.has(tx.status.toLowerCase())
  return {
    status: done ? 'completed' : failed ? 'failed' : 'pending',
    paid: tx.isPaid === true,
    receipt: done ? (tx.paymentNetworkReceipt ?? null) : null,
    kes: tx.currencyAmountSent ?? null,
  }
}

/**
 * Marks a Ferry-issued payout delivered, once. Hashes Ferry never issued are ignored. `timed`
 * says Ferry saw it live (a sender's screen polling), so the time is a real delivery time.
 */
export async function recordDelivery(
  db: Db['db'],
  hash: string,
  s: MpesaStatusResponse,
  timed: boolean,
) {
  if (s.status !== 'completed') return
  await db
    .update(lnPayouts)
    .set({ deliveredAt: new Date(), receipt: s.receipt, timed })
    .where(and(eq(lnPayouts.paymentHash, hash), isNull(lnPayouts.deliveredAt)))
}

/**
 * Checks a few recent payouts nobody has confirmed yet (the user may have closed Ferry before
 * the receipt arrived), so Proof of Ferry still counts them.
 */
export async function reconcileMpesa(db: Db['db'], fetchImpl: FetchLike, max = 10) {
  const pending = await db
    .select({ hash: lnPayouts.paymentHash })
    .from(lnPayouts)
    .where(
      and(
        isNull(lnPayouts.deliveredAt),
        eq(lnPayouts.route, 'mpesa_ln'),
        gte(lnPayouts.createdAt, new Date(Date.now() - RECONCILE_WINDOW_MS)),
      ),
    )
    .orderBy(asc(lnPayouts.createdAt))
    .limit(max)
  await Promise.all(
    pending.map(async ({ hash }) => {
      try {
        await recordDelivery(db, hash, await tandoStatus(fetchImpl, hash), false)
      } catch {
        // checked again next time
      }
    }),
  )
}
