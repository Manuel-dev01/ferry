import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { PublicClient } from 'viem'
import type { Db } from './db/client'
import type { Env } from './env'
import { HttpError, supportRef } from './errors'
import type { FetchLike } from './lightning'
import type { Logger } from './logger'
import type { MockOrderEngine } from './orders/mock-engine'
import type { PaycrestKeyed, PaycrestPublic } from './paycrest'
import type { RelayerWallet } from './polygon'
import { balancesRoutes } from './routes/balances'
import { healthRoutes } from './routes/health'
import { handoffRoutes } from './routes/handoffs'
import { payoutRoutes } from './routes/payouts'
import { v1Routes } from './routes/v1'

export interface Deps {
  env: Env
  logger: Logger
  polygon: PublicClient
  relayer: RelayerWallet | null
  db: Db | null
  fetch: FetchLike
  paycrest: { public: PaycrestPublic; keyed: PaycrestKeyed }
  orders: MockOrderEngine
}

export type AppEnv = { Variables: { requestId: string; log: Logger } }

const LAN_ORIGIN =
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/

export function isAllowedOrigin(origin: string, env: Pick<Env, 'CORS_ORIGINS' | 'NODE_ENV'>) {
  if (env.CORS_ORIGINS.includes(origin)) return true
  return env.NODE_ENV === 'development' && LAN_ORIGIN.test(origin)
}

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    const requestId = supportRef()
    const log = deps.logger.child({ requestId })
    c.set('requestId', requestId)
    c.set('log', log)
    const started = performance.now()
    await next()
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      },
      'request',
    )
  })

  app.use(
    '*',
    cors({
      origin: (origin) => (origin && isAllowedOrigin(origin, deps.env) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Client-Secret'],
      maxAge: 600,
    }),
  )

  app.onError((err, c) => {
    const ref = c.get('requestId') ?? supportRef()
    if (err instanceof HttpError) {
      c.get('log')?.warn({ code: err.code, details: err.details }, err.message)
      return c.json(
        { error: { code: err.code, message: err.message, ref, ...(err.details ?? {}) } },
        err.status,
      )
    }
    c.get('log')?.error({ err }, 'unhandled error')
    return c.json(
      { error: { code: 'INTERNAL', message: 'Something went wrong on our side', ref } },
      500,
    )
  })

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))

  app.route('/', healthRoutes(deps))
  app.route('/v1', balancesRoutes(deps))
  app.route('/v1', v1Routes(deps))
  app.route('/v1', handoffRoutes(deps))
  app.route('/v1', payoutRoutes(deps))

  return app
}
