import { classifyNimiqError, lightningIdsFrom } from '../providers/nimiq'

/**
 * Nimiq Pay's words when its swap partner (Fastspot) would not set up the swap. Seen 2026-11-19 while
 * every Fastspot swap request timed out: nothing was sent, and the invoice is fine to try again later.
 */
const SWAP_DOWN = /cannot create swap/i

/** Known payment identifiers always require reconciliation, even alongside a validation error. */
export function lightningFailure(err: unknown, expiresAt: number, now = Date.now() / 1000) {
  const error = classifyNimiqError(err)
  const ids = lightningIdsFrom(error.data)
  const uncertain =
    !!(ids.hash || ids.swapId) ||
    !['rejected', 'unsupported', 'invalid', 'insufficient'].includes(error.kind)
  const kind = uncertain
    ? 'uncertain'
    : (error.kind === 'invalid' || error.kind === 'insufficient') &&
        expiresAt > 0 &&
        expiresAt <= now
      ? 'expired'
      : error.kind === 'invalid' && SWAP_DOWN.test(error.message)
        ? 'swapDown'
        : error.kind
  return { kind, ids, said: walletReason(error.type, error.message) }
}

/**
 * Nimiq Pay's own words, for the screen: its generic types don't say why a payment was refused,
 * and a screenshot of this line is the only way to find out. Plain text, one line, kept short.
 */
function walletReason(type: string, message: string) {
  const text = message.replace(/\s+/g, ' ').trim().slice(0, 160)
  return type === 'NOT_A_PROVIDER_ERROR' ? text : [type, text].filter(Boolean).join(' · ')
}
