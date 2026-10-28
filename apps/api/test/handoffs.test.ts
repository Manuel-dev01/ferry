import { describe, expect, it } from 'vitest'
import { USDT0_ADDRESS } from '@ferry/shared'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Log } from 'viem'
import { directUsdtTransfer, TRANSFER_GAS, transferGasNeedWei } from '../src/routes/handoffs'
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

const USER: Address = '0x358bC84A34Df878A5497DFc01D14D6AaFe7E8A76'
const FONBNK: Address = '0x1111111254EEB25477B68fb85Ed929f73A960582'
const GATEWAY: Address = '0xfB411Cc6385Af50A562aFCb441864E9d541CDA67'

function transferLog(
  from: Address,
  to: Address,
  value: bigint,
  token: Address = USDT0_ADDRESS,
): Log {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  } as unknown as Log
}

describe('directUsdtTransfer', () => {
  it('accepts the wallet sending its own USDT straight to the token contract', () => {
    const receipt = { from: USER, to: USDT0_ADDRESS, logs: [transferLog(USER, FONBNK, 5_000_000n)] }
    expect(directUsdtTransfer(receipt)).toEqual({ from: USER, to: FONBNK, value: 5_000_000n })
  })

  it('rejects a transfer a contract made, like a Paycrest Gateway order', () => {
    const receipt = { from: USER, to: GATEWAY, logs: [transferLog(USER, GATEWAY, 1_000_000n)] }
    expect(directUsdtTransfer(receipt)).toBeNull()
  })

  it("rejects moving someone else's tokens", () => {
    const receipt = { from: USER, to: USDT0_ADDRESS, logs: [transferLog(FONBNK, USER, 1n)] }
    expect(directUsdtTransfer(receipt)).toBeNull()
  })

  it('rejects anything but exactly one USDT transfer', () => {
    const two = [transferLog(USER, FONBNK, 1n), transferLog(USER, FONBNK, 2n)]
    expect(directUsdtTransfer({ from: USER, to: USDT0_ADDRESS, logs: two })).toBeNull()
    expect(directUsdtTransfer({ from: USER, to: USDT0_ADDRESS, logs: [] })).toBeNull()
  })
})
