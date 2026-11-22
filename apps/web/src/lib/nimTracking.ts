import type { NimSwapState } from './nimSwap'

export interface TrackedNimSwap {
  id: string
  kind?: string
  status: string
  createdAt: number
  mock: boolean
}

/** App-wide reconciliation. Never creates an invoice or asks a wallet to pay. */
export function createNimTracker(deps: {
  entries: () => TrackedNimSwap[]
  read: (id: string) => Promise<NimSwapState>
  claim: (id: string) => Promise<unknown>
  status: (id: string, status: string) => void
  report: (id: string) => Promise<unknown>
}) {
  const running = new Set<string>()
  const claimed = new Set<string>()
  let stopped = false

  async function reconcile(entry: TrackedNimSwap) {
    if (running.has(entry.id)) return
    running.add(entry.id)
    try {
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
      // Bound unattended work, including malformed/future local timestamps. Older attempts
      // remain accessible in History for explicit status/refund investigation.
      const now = Date.now()
      await Promise.all(
        deps
          .entries()
          .filter(
            (e) =>
              e.kind === 'nim' &&
              !e.mock &&
              ['awaiting', 'swapping'].includes(e.status) &&
              e.createdAt <= now &&
              now - e.createdAt < 24 * 60 * 60_000,
          )
          .map(reconcile),
      )
    },
    stop() {
      stopped = true
    },
  }
}
