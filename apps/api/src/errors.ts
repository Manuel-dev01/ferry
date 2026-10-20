import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** An error whose code and message are safe to return to the client. */
export class HttpError extends Error {
  override name = 'HttpError'
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Short support ID shown to users instead of raw error codes, e.g. "FRY-8K2Q". */
export function supportRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return `FRY-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`
}
