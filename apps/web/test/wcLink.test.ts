import { describe, expect, it } from 'vitest'
import { parseWcLink, wcLinkExpired } from '../src/lib/wcBridge'
const uri = `wc:${'a'.repeat(64)}@2?relay-protocol=irn&symKey=${'b'.repeat(64)}`
describe('WalletConnect links', () => {
  it('accepts raw, encoded and wrapped copied links', () => {
    expect(parseWcLink(uri)).toBe(uri)
    expect(parseWcLink(encodeURIComponent(uri))).toBe(uri)
    expect(parseWcLink(`https://example.com/wc?uri=${encodeURIComponent(uri)}`)).toBe(uri)
  })
  it('rejects incomplete links and detects expiry without pairing', () => {
    expect(parseWcLink('wc:broken')).toBeNull()
    expect(parseWcLink(uri.replace('b'.repeat(64), 'bad'))).toBeNull()
    expect(wcLinkExpired(`${uri}&expiryTimestamp=1`, 2000)).toBe(true)
    expect(wcLinkExpired(`${uri}&expiryTimestamp=3`, 2000)).toBe(false)
    expect(wcLinkExpired(uri, 2000)).toBe(false)
  })
})
