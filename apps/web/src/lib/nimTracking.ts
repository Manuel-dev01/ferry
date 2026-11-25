import type { NimSwapState } from './nimSwap'

export interface TrackedNimSwap {
  id: string
  kind?: string
  status: string
  createdAt: number
  mock: boolean
  walletSwapId?: string
}

/** App-wide reconciliation. Never creates an invoice or asks a wallet to pay. */
export function createNimTracker(deps: {
  entries: () => TrackedNimSwap[]
  read: (id: string) => Promise<NimSwapState>
  refundStatus: (nativeSwapId: string) => Promise<boolean>
  claim: (id: string) => Promise<unknown>
  status: (id: string, status: string) => void
  report: (id: string) => Promise<unknown>
}) {
  const running = new Set<string>()
  const claimed = new Set<string>()
  const refundChecks = new Map<string, { at: number; refunded: boolean }>()
  let stopped = false

  async function sourceRefunded(nativeSwapId: string) {
    const now = Date.now()
    const previous = refundChecks.get(nativeSwapId)
    if (previous && now - previous.at < 60_000) return previous.refunded
    try {
      const refunded = await deps.refundStatus(nativeSwapId)
      refundChecks.set(nativeSwapId, { at: now, refunded })
      return refunded
    } catch {
      refundChecks.set(nativeSwapId, { at: now, refunded: false })
      return false
    }
  }

  async function reconcile(entry: TrackedNimSwap) {
    if (running.has(entry.id)) return
    running.add(entry.id)
    try {
      // Once LendaSwap has expired, keep checking Fastspot's NIM leg at a low rate. Fastspot
      // marks it REFUNDED after the NIM refund transaction lands, even though BTC_LN stays pending.
      if (entry.status === 'failed') {
        if (entry.walletSwapId && (await sourceRefunded(entry.walletSwapId))) {
          deps.status(entry.id, 'refunded')
        }
        return
      }
      const state = await deps.read(entry.id)
      if (stopped) return
      if (state.stage === 'ready' && !claimed.has(entry.id)) {
        // The SDK can only claim a swap whose authorisation is saved on this device.
        // Its fixed destination is set when the user creates the swap.
        claimed.add(entry.id)
        await deps.claim(entry.id)
      } else if (state.stage === 'done') {
        deps.status(entry.id, 'received')
        await deps.report(entry.id).catch(() => undefined)
      } else if (state.stage === 'failed') {
        deps.status(entry.id, 'failed')
        if (entry.walletSwapId && (await sourceRefunded(entry.walletSwapId))) {
          deps.status(entry.id, 'refunded')
        }
      }
    } catch {
      // A network error is not a failed payment. Keep reading, but do not automatically
      // repeat a claim whose response may have been lost.
    } finally {
      running.delete(entry.id)
    }
  }

  return {
    async tick() {
      if (stopped) return
      // Claims stay bounded to 24 hours. Read-only refund tracking can continue for a week,
      // because the NIM HTLC may refund days after LendaSwap expires.
      const now = Date.now()
      await Promise.all(
        deps
          .entries()
          .filter((e) => {
            if (e.kind !== 'nim' || e.mock || e.createdAt > now) return false
            const age = now - e.createdAt
            if (['awaiting', 'swapping'].includes(e.status)) return age < 24 * 60 * 60_000
            return e.status === 'failed' && !!e.walletSwapId && age < 7 * 24 * 60 * 60_000
          })
          .map(reconcile),
      )
    },
    stop() {
      stopped = true
    },
  }
}
