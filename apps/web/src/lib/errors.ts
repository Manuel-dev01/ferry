import { ApiRequestError } from './api'

type T = (key: string, values?: Record<string, unknown>) => string

/** Codes whose server text is too technical to show as is. */
const FRIENDLY: Record<string, string> = {
  TIMEOUT: 'errors.timeout',
  NETWORK: 'errors.network',
  OFFLINE: 'errors.offline',
  PARTNER_HTTP_ERROR: 'errors.partner',
  LNURL_HTTP_ERROR: 'errors.partner',
  LNURL_BAD_RESPONSE: 'errors.partner',
  LNURL_ERROR: 'errors.partner',
  LN_BAD_INVOICE: 'errors.partner',
  LN_AMOUNT_MISMATCH: 'errors.partner',
  LN_DESCRIPTION_MISMATCH: 'errors.partner',
  LN_EXPIRED: 'errors.partner',
  HTTP_ERROR: 'errors.server',
  INTERNAL: 'errors.server',
}

/**
 * A sentence a person can act on, for errors from Ferry's API. Server messages written for
 * people pass through; technical ones are replaced. The support reference is appended.
 */
export function friendlyError(err: unknown, t: T): string {
  if (!(err instanceof ApiRequestError)) return t('errors.generic')
  const key = FRIENDLY[err.code]
  const text = key ? t(key) : err.message
  return err.ref ? `${text} (${t('errors.ref', { ref: err.ref })})` : text
}
