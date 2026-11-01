import { apiErrorSchema } from '@ferry/shared'

// In development the phone loads the app from the dev machine's LAN IP; the API runs on the
// same machine, so default to that host rather than localhost (which would be the phone).
const API_URL: string =
  import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`

export class ApiRequestError extends Error {
  override name = 'ApiRequestError'
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly ref?: string,
    readonly body?: unknown,
  ) {
    super(message)
  }
}

/** No request may hang a screen: a stalled network becomes a TIMEOUT error the UI can show. */
const DEFAULT_TIMEOUT_MS = 20_000

export async function api<T>(
  path: string,
  init?: {
    method?: 'GET' | 'POST'
    body?: unknown
    headers?: Record<string, string>
    timeoutMs?: number
  },
): Promise<T> {
  const headers: Record<string, string> = { ...init?.headers }
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json'
  const signal = AbortSignal.timeout(init?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let res: Response
  let json: unknown
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    })
    json = await res.json().catch(() => null)
  } catch {
    if (signal.aborted) throw new ApiRequestError(0, 'TIMEOUT', 'The request took too long')
    throw new ApiRequestError(
      0,
      navigator.onLine === false ? 'OFFLINE' : 'NETWORK',
      'Network request failed',
    )
  }
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json)
    if (parsed.success) {
      const { code, message, ref } = parsed.data.error
      throw new ApiRequestError(res.status, code, message, ref, json)
    }
    throw new ApiRequestError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`)
  }
  return json as T
}

export const errorRef = (err: unknown) => (err instanceof ApiRequestError ? err.ref : undefined)
export const errorCode = (err: unknown) => (err instanceof ApiRequestError ? err.code : undefined)
