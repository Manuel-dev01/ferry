import { describe, expect, it } from 'vitest'
import { TRANSFER_GAS, transferGasNeedWei } from '../src/routes/handoffs'
import { json, makeApp } from './helpers'

const ADDRESS = '0x358bC84A34Df878A5497DFc01D14D6AaFe7E8A76'

describe('payout route in meta', () => {
  it('defaults to Fonbnk, with gas top-ups off', async () => {
    const body = await json(await makeApp().request('/v1/meta'))
    expect(body.payoutRoute).toBe('fonbnk')
    expect(body.gasTopup).toBe(false)
  })

  it('reports gas top-ups off when there is no relayer or database', async () => {
    const body = await json(await makeApp({ GAS_TOPUP_ENABLED: 'true' }).request('/v1/meta'))
    expect(body.gasTopup).toBe(false)
  })
})

describe('POST /v1/gas', () => {
  const post = (env: Record<string, string>) =>
    makeApp(env).request('/v1/gas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: ADDRESS }),
    })

  it('is off unless enabled', async () => {
    const res = await post({})
    expect(res.status).toBe(404)
    expect((await json(res)).error.code).toBe('GAS_TOPUP_DISABLED')
  })

  it('says so when it cannot send', async () => {
    const res = await post({ GAS_TOPUP_ENABLED: 'true' })
    expect(res.status).toBe(503)
    expect((await json(res)).error.code).toBe('GAS_UNAVAILABLE')
  })
})

describe('transferGasNeedWei', () => {
  it('covers the wallet check for one transfer with a margin', () => {
    const maxFee = 527_480_000_000n // seen in Nimiq Pay on 2026-10-28
    expect(transferGasNeedWei(maxFee)).toBe((TRANSFER_GAS * maxFee * 5n) / 4n)
    expect(transferGasNeedWei(maxFee)).toBeLessThan(10n ** 17n) // under 0.1 POL
  })
})

describe('POST /v1/handoffs', () => {
  it('rejects a body that is not a Fonbnk hand-off', async () => {
    const res = await makeApp().request('/v1/handoffs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txHash: '0x12',
        provider: 'someone',
        currency: 'NGN',
        channel: 'bank',
      }),
    })
    expect(res.status).toBe(503) // no database in tests; checked before anything else
  })
})
