import { describe, expect, it } from 'vitest'
import { parseUsdtPayment, parseWcLink, wcLinkExpired } from '../src/lib/wcBridge'
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

describe('parseUsdtPayment', () => {
  const ME = '0x1111111111111111111111111111111111111111'
  const FONBNK = '0x2222222222222222222222222222222222222222'
  const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
  const data = (to: string, units: bigint) =>
    '0xa9059cbb' + to.slice(2).padStart(64, '0') + units.toString(16).padStart(64, '0')

  it('reads a plain USDT transfer from this wallet', () => {
    const tx = { from: ME, to: USDT.toLowerCase(), data: data(FONBNK, 4_000_000n), value: '0x0' }
    expect(parseUsdtPayment(tx, ME)).toEqual({ to: FONBNK, units: 4_000_000n })
  })

  it.each([
    ['another token', { to: FONBNK, data: data(FONBNK, 1n) }],
    ['another sender', { from: FONBNK, to: USDT, data: data(FONBNK, 1n) }],
    ['POL attached', { to: USDT, data: data(FONBNK, 1n), value: '0x5' }],
    ['a zero amount', { to: USDT, data: data(FONBNK, 0n) }],
    ['a payment to itself', { to: USDT, data: data(ME, 1n) }],
    ['extra calldata', { to: USDT, data: data(FONBNK, 1n) + '00' }],
    ['no data', { to: USDT }],
  ])('refuses %s', (_, tx) => {
    expect(parseUsdtPayment(tx, ME)).toBeNull()
  })
})
