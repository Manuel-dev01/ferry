import { Hono } from 'hono'
import type { AppEnv, Deps } from '../app'

type Check = 'ok' | 'fail' | 'skipped'

const PAYCREST_PING = 'https://api.paycrest.io/v1/currencies'

async function check(fn: () => Promise<unknown>): Promise<Check> {
  try {
    await fn()
    return 'ok'
  } catch {
    return 'fail'
  }
}

export function healthRoutes(deps: Deps) {
  const r = new Hono<AppEnv>()

  r.get('/health', (c) => c.json({ ok: true }))

  r.get('/ready', async (c) => {
    const [db, rpc, paycrest] = await Promise.all([
      deps.db ? check(() => deps.db!.sql`select 1`) : Promise.resolve<Check>('skipped'),
      check(() => deps.polygon.getBlockNumber()),
      check(async () => {
        const res = await deps.fetch(PAYCREST_PING, { signal: AbortSignal.timeout(5_000) })
        if (!res.ok) throw new Error(`paycrest ${res.status}`)
      }),
    ])
    const checks = { db, rpc, paycrest }
    const ok = Object.values(checks).every((v) => v !== 'fail')
    return c.json({ ok, checks }, ok ? 200 : 503)
  })

  return r
}
