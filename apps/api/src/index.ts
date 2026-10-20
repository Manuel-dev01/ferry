import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createDb } from './db/client'
import { loadEnv } from './env'
import { createLogger } from './logger'
import { MockOrderEngine } from './orders/mock-engine'
import { PaycrestMock, PaycrestPublic } from './paycrest'
import { createPolygonClient, createRelayerWallet } from './polygon'

const env = loadEnv()
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development')
const polygon = createPolygonClient(env.POLYGON_RPC_URLS)
const relayer = env.RELAYER_PRIVATE_KEY
  ? createRelayerWallet(env.POLYGON_RPC_URLS, env.RELAYER_PRIVATE_KEY as `0x${string}`)
  : null
const db = env.DATABASE_URL ? createDb(env.DATABASE_URL) : null

if (env.PAYCREST_MODE === 'live') {
  // The live keyed client and order engine arrive with the Paycrest key (milestone M1).
  throw new Error('PAYCREST_MODE=live is not implemented yet')
}
const paycrest = {
  public: new PaycrestPublic(globalThis.fetch, env.PAYCREST_BASE_URL),
  keyed: new PaycrestMock(),
}
const orders = new MockOrderEngine(polygon, env.USDT0_ADDRESS as `0x${string}`)

const app = createApp({
  env,
  logger,
  polygon,
  relayer,
  db,
  fetch: globalThis.fetch,
  paycrest,
  orders,
})

serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info(
    {
      port: info.port,
      spikes: env.SPIKES_ENABLED,
      relayer: relayer?.account.address ?? null,
      db: Boolean(db),
      paycrest: paycrest.keyed.mode,
    },
    'ferry api listening',
  )
})
