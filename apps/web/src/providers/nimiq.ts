import { init, NimiqProviderError, type NimiqProvider } from '@nimiq/mini-app-sdk'

export type { NimiqProvider }

const INIT_TIMEOUT_MS = 10_000

let pending: Promise<NimiqProvider> | null = null

/** Waits for Nimiq Pay to inject its provider. Rejects with a plain Error outside Nimiq Pay. */
export function initNimiq(): Promise<NimiqProvider> {
  // Inline env check (not MOCK_WALLET) so production builds drop the mock entirely.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true') {
    pending ??= import('../dev/mockWallet').then((m) => m.installMockWallet())
    return pending
  }
  pending ??= init({ timeout: INIT_TIMEOUT_MS }).catch((err: unknown) => {
    pending = null
    throw err
  })
  return pending
}

export type NimiqErrorKind =
  | 'rejected'
  | 'unsupported'
  | 'invalid'
  | 'insufficient'
  | 'network'
  | 'duplicate'
  | 'outcome_unknown'
  | 'wallet'
  | 'unknown'

export interface ClassifiedNimiqError {
  kind: NimiqErrorKind
  type: string
  message: string
  data?: unknown
}

/** Maps a provider rejection to how the UI should react. Unlisted types fall through to 'unknown'. */
export function classifyNimiqError(err: unknown): ClassifiedNimiqError {
  if (!NimiqProviderError.is(err)) {
    return { kind: 'unknown', type: 'NOT_A_PROVIDER_ERROR', message: String(err) }
  }
  const base = { type: err.type, message: err.message, data: err.data }
  switch (err.type) {
    case 'PERMISSION_DENIED':
      return { kind: 'rejected', ...base }
    case 'UNKNOWN_REQUEST':
      return { kind: 'unsupported', ...base }
    case 'INVALID_REQUEST':
    case 'INVALID_TRANSACTION':
      // Only classify an explicit validation rejection as a balance failure.
      // Network, duplicate and unknown outcomes must keep their conservative handling.
      return {
        kind: /insufficient (?:nim |usdt |wallet )?(?:funds|balance)|not enough (?:nim|usdt|funds|balance)|balance (?:is )?too low/i.test(
          err.message,
        )
          ? 'insufficient'
          : 'invalid',
        ...base,
      }
    case 'NETWORK_ERROR':
      return { kind: 'network', ...base }
    case 'DUPLICATE_PAYMENT':
      return { kind: 'duplicate', ...base }
    case 'TRANSACTION_OUTCOME_UNKNOWN':
      return { kind: 'outcome_unknown', ...base }
    case 'INTERNAL_ERROR':
      return { kind: 'wallet', ...base }
    default:
      return { kind: 'unknown', ...base }
  }
}

/** Lightning payment identifiers the host may attach to duplicate/unknown errors. */
export function lightningIdsFrom(data: unknown): { hash?: string; swapId?: string } {
  if (!data || typeof data !== 'object') return {}
  const d = data as Record<string, unknown>
  return {
    hash: typeof d.hash === 'string' ? d.hash : undefined,
    swapId: typeof d.swapId === 'string' ? d.swapId : undefined,
  }
}
