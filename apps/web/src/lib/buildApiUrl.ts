/** Production must never silently fall back to the visitor's hostname on port 3000. */
export function requireProductionApiUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('VITE_API_URL is required for a production web build')
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error(
      'VITE_API_URL must be a public HTTPS API URL without credentials, query or fragment',
    )
  return value.replace(/\/+$/, '')
}
