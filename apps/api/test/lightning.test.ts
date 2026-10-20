import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const decodeMock = vi.fn()
vi.mock('light-bolt11-decoder', () => ({ decode: (pr: string) => decodeMock(pr) }))

const {
  checkVerifyUrl,
  lightningAddressUrl,
  requestInvoice,
  resolveLightningAddress,
  summarizeMetadata,
  validateInvoice,
} = await import('../src/lightning')

const metadata = JSON.stringify([
  ['text/plain', 'Pay 0712345678'],
  ['text/identifier', '0712345678@bitcoin.co.ke'],
])
const metadataHash = bytesToHex(sha256(utf8ToBytes(metadata)))
const NOW = 1_800_000_000
const PAYMENT_HASH = 'ab'.repeat(32)

function sections(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    amount: '100000',
    timestamp: NOW,
    expiry: 600,
    description_hash: metadataHash,
    payment_hash: PAYMENT_HASH,
    ...overrides,
  }
  return {
    sections: Object.entries(base)
      .filter(([, v]) => v !== undefined)
      .map(([name, value]) => ({ name, value })),
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  decodeMock.mockReset()
})

describe('lightningAddressUrl', () => {
  it('maps LUD-16 addresses to the well-known URL', () => {
    expect(lightningAddressUrl('0712345678@bitcoin.co.ke')).toBe(
      'https://bitcoin.co.ke/.well-known/lnurlp/0712345678',
    )
    expect(() => lightningAddressUrl('nobody')).toThrow()
  })
})

describe('validateInvoice', () => {
  const expected = { amountMsat: 100_000n, metadata, nowSeconds: NOW }

  it('accepts a matching mainnet invoice', () => {
    decodeMock.mockReturnValue(sections())
    expect(validateInvoice('lnbc1000n1xyz', expected)).toEqual({
      paymentHash: PAYMENT_HASH,
      amountMsat: 100_000n,
      expiresAt: NOW + 600,
    })
  })

  it('rejects non-mainnet invoices', () => {
    decodeMock.mockReturnValue(sections())
    expect(() => validateInvoice('lntb1000n1xyz', expected)).toThrow(/mainnet/)
    expect(() => validateInvoice('lnbcrt1000n1xyz', expected)).toThrow(/mainnet/)
  })

  it('rejects a different amount, a missing amount, or a description mismatch', () => {
    decodeMock.mockReturnValue(sections({ amount: '100001' }))
    expect(() => validateInvoice('lnbc1', expected)).toThrow(/amount/)
    decodeMock.mockReturnValue(sections({ amount: undefined }))
    expect(() => validateInvoice('lnbc1', expected)).toThrow(/amount/)
    decodeMock.mockReturnValue(sections({ description_hash: '00'.repeat(32) }))
    expect(() => validateInvoice('lnbc1', expected)).toThrow(/match/)
  })

  it('rejects invoices that are expired or about to expire', () => {
    decodeMock.mockReturnValue(sections({ timestamp: NOW - 600 }))
    expect(() => validateInvoice('lnbc1', expected)).toThrow(/expired/)
    decodeMock.mockReturnValue(sections({ expiry: 30 }))
    expect(() => validateInvoice('lnbc1', expected)).toThrow(/expired/)
  })

  it('reports undecodable invoices', () => {
    decodeMock.mockImplementation(() => {
      throw new Error('bad checksum')
    })
    expect(() => validateInvoice('lnbc1', expected)).toThrow(/decoded/)
  })
})

describe('LNURL flow', () => {
  const payRequest = {
    tag: 'payRequest',
    callback: 'https://bitcoin.co.ke/lnurlp/callback/abc?token=1',
    minSendable: 1000,
    maxSendable: 5_000_000,
    metadata,
  }

  it('resolves, then requests an invoice with the amount appended', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(payRequest))
      .mockResolvedValueOnce(jsonResponse({ pr: 'lnbc1', verify: 'https://bitcoin.co.ke/v/1' }))
    const { payRequest: pr } = await resolveLightningAddress(fetchMock, 'a@bitcoin.co.ke')
    const { invoice } = await requestInvoice(fetchMock, pr, 100_000n)
    expect(invoice.verify).toBe('https://bitcoin.co.ke/v/1')
    const url = new URL(fetchMock.mock.calls[1]![0] as string)
    expect(url.searchParams.get('amount')).toBe('100000')
    expect(url.searchParams.get('token')).toBe('1')
  })

  it('refuses amounts outside min/max before calling the service', async () => {
    const fetchMock = vi.fn()
    const pr = { ...payRequest, tag: 'payRequest' as const }
    await expect(requestInvoice(fetchMock, pr, 999n)).rejects.toMatchObject({
      code: 'LN_AMOUNT_OUT_OF_RANGE',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces LNURL errors and unreachable services', async () => {
    await expect(
      resolveLightningAddress(
        vi.fn().mockResolvedValue(jsonResponse({ status: 'ERROR', reason: 'no user' }, 404)),
        'a@b.co',
      ),
    ).rejects.toMatchObject({ code: 'LNURL_ERROR' })
    await expect(
      resolveLightningAddress(vi.fn().mockRejectedValue(new Error('ECONNRESET')), 'a@b.co'),
    ).rejects.toMatchObject({ code: 'LNURL_UNREACHABLE' })
  })

  it('reads LUD-21 verify replies', async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'OK', settled: true, preimage: 'x' }))
    expect(await checkVerifyUrl(ok, 'https://b.co/v')).toBe(true)
    await expect(checkVerifyUrl(vi.fn(), 'http://b.co/v')).rejects.toMatchObject({
      code: 'LNURL_INSECURE',
    })
  })
})

describe('summarizeMetadata', () => {
  it('extracts text entries and hides images', () => {
    const md = JSON.stringify([
      ['text/plain', 'hello'],
      ['image/png;base64', 'AAAA'],
    ])
    expect(summarizeMetadata(md)).toEqual({
      'text/plain': 'hello',
      'image/png;base64': '[4 chars]',
    })
    expect(summarizeMetadata('not json')).toEqual({})
  })
})
