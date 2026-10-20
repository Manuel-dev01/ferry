import pino from 'pino'
import type { PublicClient } from 'viem'
import { vi } from 'vitest'
import { createApp } from '../src/app'
import { loadEnv } from '../src/env'
import type { FetchLike } from '../src/lightning'
import { MockOrderEngine } from '../src/orders/mock-engine'
import { PaycrestMock, PaycrestPublic } from '../src/paycrest'

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Answers Paycrest's public endpoints with small fixtures; everything else is an empty list. */
export function paycrestFetch(): FetchLike {
  return vi.fn(async (url: string) => {
    if (url.includes('/v1/institutions/NGN')) {
      return jsonResponse({
        status: 'success',
        data: [
          { code: 'GTBINGLA', name: 'Guaranty Trust Bank', type: 'bank' },
          { code: 'OPAYNGPC', name: 'OPay', type: 'bank' },
        ],
      })
    }
    if (url.includes('/v2/rates/polygon/USDT/')) {
      return jsonResponse({ data: { sell: { rate: '1353.05', providerIds: ['a'] } } })
    }
    return jsonResponse([])
  }) as unknown as FetchLike
}

export function makeApp(
  envOverrides: Record<string, string> = {},
  polygon: Partial<PublicClient> = {},
  fetchImpl: FetchLike = paycrestFetch(),
) {
  const env = loadEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'https://ferry.example', ...envOverrides })
  const client = polygon as PublicClient
  return createApp({
    env,
    logger: pino({ level: 'silent' }),
    polygon: client,
    relayer: null,
    db: null,
    fetch: fetchImpl,
    paycrest: {
      public: new PaycrestPublic(fetchImpl, env.PAYCREST_BASE_URL),
      keyed: new PaycrestMock(),
    },
    orders: new MockOrderEngine(client, env.USDT0_ADDRESS as `0x${string}`),
  })
}

/** Loose JSON reader for assertions on API responses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (res: Response): Promise<any> => res.json()
