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

export async function api<T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiRequestError(0, 'OFFLINE', 'Network request failed')
  }
  const json: unknown = await res.json().catch(() => null)
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
