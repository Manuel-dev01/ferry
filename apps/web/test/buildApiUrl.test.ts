import { describe, expect, it } from 'vitest'
import { requireProductionApiUrl } from '../src/lib/buildApiUrl'
describe('production API build configuration', () => {
  it.each([
    undefined,
    '',
    'http://example.com',
    'https://localhost:3000',
    'https://user:secret@example.com',
    'https://example.com?token=secret',
  ])('rejects missing or unsafe API origin %s', (value) => {
    expect(() => requireProductionApiUrl(value)).toThrow()
  })
  it('accepts and normalizes the configured public API', () => {
    expect(requireProductionApiUrl('https://api-production-5835.up.railway.app/')).toBe(
      'https://api-production-5835.up.railway.app',
    )
  })
})
