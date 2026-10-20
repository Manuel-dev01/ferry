import { Writable } from 'node:stream'
import pino from 'pino'
import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { createApp, isAllowedOrigin } from '../src/app'
import { loadEnv } from '../src/env'
import { REDACT_PATHS } from '../src/logger'

const silent = pino({ level: 'silent' })

function makeApp(envOverrides: Record<string, string> = {}, polygon: Partial<PublicClient> = {}) {
  const env = loadEnv({ NODE_ENV: 'test', CORS_ORIGINS: 'https://ferry.example', ...envOverrides })
  return createApp({
    env,
    logger: silent,
    polygon: polygon as PublicClient,
    relayer: null,
    db: null,
    fetch: vi.fn().mockResolvedValue(new Response('[]')),
  })
}

describe('health', () => {
  it('answers /health', async () => {
    const res = await makeApp().request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('reports readiness per dependency', async () => {
    const up = makeApp({}, { getBlockNumber: vi.fn().mockResolvedValue(1n) })
    expect(await (await up.request('/ready')).json()).toEqual({
      ok: true,
      checks: { db: 'skipped', rpc: 'ok', paycrest: 'ok' },
    })
    const down = makeApp({}, { getBlockNumber: vi.fn().mockRejectedValue(new Error('rpc down')) })
    const res = await down.request('/ready')
    expect(res.status).toBe(503)
  })
})

describe('CORS', () => {
  it('allows configured origins and rejects others', async () => {
    const app = makeApp()
    const ok = await app.request('/health', { headers: { Origin: 'https://ferry.example' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://ferry.example')
    const bad = await app.request('/health', { headers: { Origin: 'https://evil.example' } })
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows LAN origins only in development', () => {
    const lan = 'http://192.168.1.42:5173'
    expect(isAllowedOrigin(lan, { CORS_ORIGINS: [], NODE_ENV: 'development' })).toBe(true)
    expect(isAllowedOrigin(lan, { CORS_ORIGINS: [], NODE_ENV: 'production' })).toBe(false)
    expect(
      isAllowedOrigin('http://8.8.8.8:5173', { CORS_ORIGINS: [], NODE_ENV: 'development' }),
    ).toBe(false)
  })
})

describe('balances', () => {
  it('returns base-unit strings', async () => {
    const app = makeApp(
      {},
      {
        readContract: vi.fn().mockResolvedValue(12_340_000n) as never,
        getBalance: vi.fn().mockResolvedValue(10n ** 17n),
      },
    )
    const res = await app.request('/v1/balances/0x1111111111111111111111111111111111111111')
    expect(await res.json()).toEqual({
      address: '0x1111111111111111111111111111111111111111',
      usdt: '12340000',
      pol: '100000000000000000',
    })
  })

  it('rejects bad addresses with a structured error', async () => {
    const res = await makeApp().request('/v1/balances/0x123')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; ref: string } }
    expect(body.error.code).toBe('INVALID_REQUEST')
    expect(body.error.ref).toMatch(/^FRY-[0-9A-Z]{4}$/)
  })

  it('hides RPC failures behind a friendly error', async () => {
    const app = makeApp(
      {},
      {
        readContract: vi.fn().mockRejectedValue(new Error('boom')) as never,
        getBalance: vi.fn().mockResolvedValue(0n),
      },
    )
    const res = await app.request('/v1/balances/0x1111111111111111111111111111111111111111')
    expect(res.status).toBe(503)
  })
})

describe('spikes flag', () => {
  it('is not mounted unless SPIKES_ENABLED=true', async () => {
    expect((await makeApp().request('/spike/nim/challenge')).status).toBe(404)
    const on = makeApp({
      SPIKES_ENABLED: 'true',
      SPIKE_ALLOWED_RECIPIENT: '0x1111111111111111111111111111111111111111',
    })
    expect((await on.request('/spike/nim/challenge')).status).toBe(200)
  })
})

describe('env', () => {
  it('requires a recipient when spikes are on, and a database in production', () => {
    expect(() => loadEnv({ SPIKES_ENABLED: 'true' })).toThrow(/SPIKE_ALLOWED_RECIPIENT/)
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/)
  })

  it('never echoes secret values in errors', () => {
    expect(() => loadEnv({ RELAYER_PRIVATE_KEY: 'super-secret-value' })).toThrow(
      /^(?!.*super-secret-value)/s,
    )
  })
})

describe('logger redaction', () => {
  it('censors secrets and PII', () => {
    const lines: string[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk))
        cb()
      },
    })
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink)
    log.info({ signature: '0xabc', body: { phone: '0712', nested: { accountName: 'ADA' } } })
    const out = lines.join('')
    expect(out).not.toContain('0xabc')
    expect(out).not.toContain('0712')
    expect(out).not.toContain('ADA')
  })
})
