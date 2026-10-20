import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createDb } from './db/client'
import { loadEnv } from './env'
import { createLogger } from './logger'
import { createPolygonClient, createRelayerWallet } from './polygon'

const env = loadEnv()
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development')
const polygon = createPolygonClient(env.POLYGON_RPC_URLS)
const relayer = env.RELAYER_PRIVATE_KEY
  ? createRelayerWallet(env.POLYGON_RPC_URLS, env.RELAYER_PRIVATE_KEY as `0x${string}`)
  : null
const db = env.DATABASE_URL ? createDb(env.DATABASE_URL) : null

const app = createApp({ env, logger, polygon, relayer, db, fetch: globalThis.fetch })

serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info(
    {
      port: info.port,
      spikes: env.SPIKES_ENABLED,
      relayer: relayer?.account.address ?? null,
      db: Boolean(db),
    },
    'ferry api listening',
  )
})
