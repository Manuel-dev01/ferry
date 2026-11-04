import { classifyNimiqError, lightningIdsFrom } from '../providers/nimiq'

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
      : error.kind
  return { kind, ids }
}
