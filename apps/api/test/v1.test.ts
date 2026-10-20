import {
  META_TX_TYPES,
  USDT0_DOMAIN,
  type CreateOfframpResponse,
  type OrderView,
  type QuoteResponse,
} from '@ferry/shared'
import type { PublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, makeApp } from './helpers'

const user = privateKeyToAccount(generatePrivateKey())
const polygon: Partial<PublicClient> = {
  readContract: vi.fn().mockResolvedValue(0n) as never, // getNonce(user) = 0
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

describe('v1 meta and catalogue', () => {
  it('describes corridors, limits and the Paycrest mode', async () => {
    const res = await makeApp().request('/v1/meta')
    const body = await json(res)
    expect(body.corridors.map((c: { currency: string }) => c.currency)).toEqual([
      'NGN',
      'KES',
      'UGX',
      'TZS',
    ])
    expect(body.paycrestMode).toBe('mock')
    expect(body.fees.ferryFeeBps).toBe(50)
  })

  it('lists institutions and rejects unknown currencies', async () => {
    const app = makeApp()
    const list = await json(await app.request('/v1/institutions/NGN'))
    expect(list[0]).toEqual({ code: 'GTBINGLA', name: 'Guaranty Trust Bank', type: 'bank' })
    expect((await app.request('/v1/institutions/USD')).status).toBe(400)
  })

  it('quotes on the server from live rates', async () => {
    const res = await makeApp().request('/v1/quote?currency=NGN&amount=20&amountIn=usdt')
    const q = (await json(res)) as QuoteResponse
    expect(q).toMatchObject({
      rate: '1353.05',
      amountUnits: '20000000',
      ferryFeeUnits: '100000',
      youSendUnits: '20100000',
      theyReceiveMinor: '2706100',
      validForSeconds: 90,
    })
  })

  it('reports a paused corridor', async () => {
    const res = await makeApp({ CORRIDORS_ENABLED: 'NGN' }).request(
      '/v1/quote?currency=KES&amount=20&amountIn=usdt',
    )
    expect(res.status).toBe(503)
    expect((await json(res)).error.code).toBe('CORRIDOR_PAUSED')
  })
})

describe('v1 account verification (mock)', () => {
  const verify = (accountIdentifier: string) =>
    makeApp().request(
      '/v1/accounts/verify',
      post({ currency: 'NGN', institution: 'GTBINGLA', accountIdentifier }),
    )

  it('returns a name and a masked number', async () => {
    const body = await json(await verify('0123456789'))
    expect(body.masked).toBe('••••6789')
    expect(body.accountName).toMatch(/^[A-Z ]+$/)
  })

  it('exercises not-found, unavailable and invalid states', async () => {
    expect((await json(await verify('0123450000'))).error.code).toBe('ACCOUNT_NOT_FOUND')
    expect((await verify('0123459999')).status).toBe(503)
    expect((await json(await verify('12345'))).error.code).toBe('INVALID_ACCOUNT')
  })
})

describe('v1 off-ramp order (mock engine)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const orderBody = {
    currency: 'NGN',
    institution: 'GTBINGLA',
    accountIdentifier: '0123456789',
    accountName: 'ADA OBI',
    amount: '20',
    amountIn: 'usdt',
    evmAddress: user.address,
    recipientKind: 'self',
  }

  it('creates, verifies a real signature, and simulates settlement', async () => {
    const app = makeApp({}, polygon)
    const created = (await json(
      await app.request('/v1/orders/offramp', post(orderBody)),
    )) as CreateOfframpResponse
    expect(created.order.status).toBe('created')
    expect(created.order.amountToTransferUnits).toBe('20100000')

    const { message } = created.signing
    const signature = await user.signTypedData({
      domain: USDT0_DOMAIN,
      types: META_TX_TYPES,
      primaryType: 'MetaTransaction',
      message: {
        nonce: BigInt(message.nonce),
        from: message.from,
        functionSignature: message.functionSignature,
      },
    })
    const secret = { 'X-Client-Secret': created.clientSecret }
    const signed = await app.request(
      `/v1/orders/${created.orderId}/signature`,
      post({ signature }, secret),
    )
    expect(((await json(signed)) as OrderView).status).toBe('submitted')

    // Signing twice is refused.
    const again = await app.request(
      `/v1/orders/${created.orderId}/signature`,
      post({ signature }, secret),
    )
    expect((await json(again)).error.code).toBe('ORDER_ALREADY_SIGNED')

    await vi.advanceTimersByTimeAsync(20_000)
    const final = (await json(
      await app.request(`/v1/orders/${created.orderId}`, { headers: secret }),
    )) as OrderView
    expect(final.status).toBe('settled')
    expect(final.timeline.map((t) => t.status)).toEqual([
      'created',
      'signed',
      'submitted',
      'deposited',
      'pending',
      'validated',
      'settled',
    ])
  })

  it('rejects a signature from another wallet and hides orders without the secret', async () => {
    const app = makeApp({}, polygon)
    const created = (await json(
      await app.request('/v1/orders/offramp', post(orderBody)),
    )) as CreateOfframpResponse
    const intruder = privateKeyToAccount(generatePrivateKey())
    const { message } = created.signing
    const signature = await intruder.signTypedData({
      domain: USDT0_DOMAIN,
      types: META_TX_TYPES,
      primaryType: 'MetaTransaction',
      message: {
        nonce: BigInt(message.nonce),
        from: message.from,
        functionSignature: message.functionSignature,
      },
    })
    const res = await app.request(
      `/v1/orders/${created.orderId}/signature`,
      post({ signature }, { 'X-Client-Secret': created.clientSecret }),
    )
    expect((await json(res)).error.code).toBe('METATX_WRONG_SIGNER')
    expect((await app.request(`/v1/orders/${created.orderId}`)).status).toBe(404)
    expect(
      (
        await app.request(`/v1/orders/${created.orderId}`, {
          headers: { 'X-Client-Secret': 'nope' },
        })
      ).status,
    ).toBe(404)
  })

  it('expires unsigned orders and enforces limits', async () => {
    const app = makeApp({}, polygon)
    const created = (await json(
      await app.request('/v1/orders/offramp', post(orderBody)),
    )) as CreateOfframpResponse
    await vi.advanceTimersByTimeAsync(91_000)
    const view = await json(
      await app.request(`/v1/orders/${created.orderId}`, {
        headers: { 'X-Client-Secret': created.clientSecret },
      }),
    )
    expect(view.status).toBe('expired')

    const tooBig = await app.request('/v1/orders/offramp', post({ ...orderBody, amount: '250' }))
    expect((await json(tooBig)).error.code).toBe('OUTSIDE_LIMITS')
  })
})
