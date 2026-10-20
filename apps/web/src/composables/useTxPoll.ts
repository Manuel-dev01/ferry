import type { SpikeTxResponse } from '@ferry/shared'
import { api } from '../lib/api'

const POLL_MS = 4_000
const MAX_POLLS = 45 // 3 minutes

/** Polls the API for a receipt. Read-only: it never resends anything. */
export async function pollTx(
  hash: string,
  onTick?: (n: number) => void,
): Promise<SpikeTxResponse['status']> {
  for (let n = 1; n <= MAX_POLLS; n++) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    onTick?.(n)
    try {
      const res = await api<SpikeTxResponse>(`/spike/tx/${hash}`)
      if (res.status === 'success' || res.status === 'reverted') return res.status
    } catch {
      // keep polling: a flaky read is not an outcome
    }
  }
  return 'pending'
}
