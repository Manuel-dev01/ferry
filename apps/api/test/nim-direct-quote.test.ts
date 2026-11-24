import { describe, expect, it, vi } from 'vitest'
import { USDT0_ADDRESS } from '@ferry/shared'
import { selectDirectPair, verifyDirectNimQuote } from '../src/nim-direct-quote'

const nim = { name: 'nim', enabled: true, inboundEnabled: true, precision: 5, blockchain: 'nimiq' }
const usdt = {
  name: 'usdtmrc20',
  enabled: true,
  outboundEnabled: true,
  precision: 6,
  blockchain: 'polygon',
  contractAddress: USDT0_ADDRESS,
}
const assets = [nim, usdt]
const pairs = [{ from: 'NIM', to: 'USDTMRC20' }]
const response = (result: unknown) =>
  Response.json({ jsonrpc: '2.0', id: 'ferry-quote-check', result })

describe('direct NIM swap quote verification', () => {
  it('requires a server key before any request', async () => {
    const fetch = vi.fn()
    await expect(verifyDirectNimQuote(undefined, 1n, fetch)).rejects.toThrow('API_KEY_REQUIRED')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires exact token and network; ticker alone is insufficient', () => {
    expect(() => selectDirectPair([nim, { ...usdt, contractAddress: undefined }])).toThrow(
      'PAIR_NOT_VERIFIED',
    )
    expect(() =>
      selectDirectPair([nim, { ...usdt, contractAddress: '0x' + '1'.repeat(40) }]),
    ).toThrow('PAIR_NOT_VERIFIED')
    expect(() => selectDirectPair([nim, { ...usdt, blockchain: 'ethereum' }])).toThrow(
      'PAIR_NOT_VERIFIED',
    )
    expect(() => selectDirectPair([nim, { ...usdt, precision: 18 }])).toThrow('PAIR_NOT_VERIFIED')
  })
  it('rejects disabled or ambiguous currencies and contradictory status aliases', () => {
    expect(() => selectDirectPair([{ ...nim, inboundEnabled: false }, usdt])).toThrow(
      'PAIR_NOT_VERIFIED',
    )
    expect(() => selectDirectPair([nim, { ...usdt, enabledTo: false }])).toThrow(
      'PAIR_NOT_VERIFIED',
    )
    expect(() => selectDirectPair([nim, usdt, { ...usdt, name: 'other' }])).toThrow(
      'PAIR_NOT_VERIFIED',
    )
    expect(() => selectDirectPair([{ ...nim, precision: 8 }, usdt])).toThrow('PAIR_NOT_VERIFIED')
  })
  it('accepts documented status aliases without depending on unrelated asset metadata', () => {
    expect(
      selectDirectPair([
        { ...nim, inboundEnabled: undefined, enabledFrom: true },
        { ...usdt, outboundEnabled: undefined, enabledTo: true },
        { name: 'unrelated' },
      ]),
    ).toEqual({ from: 'nim', to: 'usdtmrc20' })
  })
  it('rounds a provider minimum up to Luna and skips the estimate when under it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(assets))
      .mockResolvedValueOnce(response(pairs))
      .mockResolvedValueOnce(response('1.000001'))
    const q = await verifyDirectNimQuote('fixture-key', 100000n, fetch)
    expect(q).toMatchObject({ available: false, minimumLuna: 100001n })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('sends exact decimal strings, reads only, and rounds the received estimate down', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(assets))
      .mockResolvedValueOnce(response(pairs))
      .mockResolvedValueOnce(response('1.000001'))
      .mockResolvedValueOnce(response('1.23456789'))
    const q = await verifyDirectNimQuote('fixture-key', 9007199254740991n, fetch)
    expect(q).toMatchObject({ available: true, minimumLuna: 100001n, estimatedUsdtUnits: 1234567n })
    const requests = fetch.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(requests.map((r) => r.method)).toEqual([
      'getCurrenciesFull',
      'getPairs',
      'getMinAmount',
      'getExchangeAmount',
    ])
    expect(requests[3].params.amount).toBe('90071992547.40991')
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.changehero.io/')
    expect(fetch.mock.calls[0]?.[1].redirect).toBe('error')
  })
  it.each([1.2, '1e4', '-1', 'NaN', '1.2.3'])(
    'rejects an inexact/malformed provider amount %s',
    async (amount) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(assets))
        .mockResolvedValueOnce(response(pairs))
        .mockResolvedValueOnce(response(amount))
      await expect(verifyDirectNimQuote('fixture-key', 1000000n, fetch)).rejects.toThrow(
        'INVALID_DECIMAL_AMOUNT',
      )
    },
  )
  it('does not expose credentials or upstream error details', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('fixture-key plus upstream private details'))
    await expect(verifyDirectNimQuote('fixture-key', 1n, fetch)).rejects.toThrow(
      /^PROVIDER_UNAVAILABLE$/,
    )
  })
  it('rejects a mismatched JSON-RPC response and invalid assets', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 'wrong', result: assets }))
    await expect(verifyDirectNimQuote('fixture-key', 1n, fetch)).rejects.toThrow(
      'PROVIDER_BAD_RESPONSE',
    )
    expect(() => selectDirectPair({ assets })).toThrow('INVALID_ASSET_METADATA')
  })
  it('does not quote an amount that the wallet cannot represent exactly', async () => {
    const fetch = vi.fn()
    await expect(verifyDirectNimQuote('fixture-key', 9007199254740992n, fetch)).rejects.toThrow(
      'INVALID_NIM_AMOUNT',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ allowed: [] }, { allowed: [{ from: 'usdtmrc20', to: 'nim' }] }])(
    'does not treat two enabled assets as an enabled forward pair',
    async ({ allowed }) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(assets))
        .mockResolvedValueOnce(response(allowed))
      await expect(verifyDirectNimQuote('fixture-key', 1000000n, fetch)).rejects.toThrow(
        'PAIR_NOT_ENABLED',
      )
      expect(fetch).toHaveBeenCalledTimes(2)
    },
  )
  it('rejects missing pair permissions rather than guessing', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(assets))
      .mockResolvedValueOnce(response(null))
    await expect(verifyDirectNimQuote('fixture-key', 1000000n, fetch)).rejects.toThrow(
      'INVALID_PAIR_METADATA',
    )
  })
})
