import { parseUnits, POL_DECIMALS, USDT0_ADDRESS, USDT_DECIMALS } from '@ferry/shared'
import { z } from 'zod'

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true')

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected an EVM address')
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 0x-prefixed 32-byte hex key')

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url().optional(),
    CORS_ORIGINS: csv,
    PUBLIC_WEB_ORIGIN: z.string().url().optional(),

    POLYGON_RPC_URLS: csv.pipe(
      z.array(z.string().url()).min(1, 'Set at least one Polygon RPC URL'),
    ),
    USDT0_ADDRESS: address.default(USDT0_ADDRESS),
    RELAYER_PRIVATE_KEY: privateKey.optional(),

    SPIKES_ENABLED: bool('false'),
    SPIKE_ALLOWED_RECIPIENT: address.optional(),
    SPIKE_MAX_USDT: z.string().default('1'),
    SPIKE_MAX_RELAYS: z.coerce.number().int().nonnegative().default(10),
    SPIKE_LN_MAX_SATS: z.coerce.number().int().positive().default(2000),
    GAS_DRIP_ENABLED: bool('false'),
    GAS_DRIP_AMOUNT_POL: z.string().default('0.02'),
    GAS_DRIP_MAX_TOTAL: z.coerce.number().int().nonnegative().default(5),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Required in production' })
    }
    if (env.SPIKES_ENABLED && !env.SPIKE_ALLOWED_RECIPIENT) {
      ctx.addIssue({
        code: 'custom',
        path: ['SPIKE_ALLOWED_RECIPIENT'],
        message: 'Required when SPIKES_ENABLED=true',
      })
    }
  })
  .transform((env) => ({
    ...env,
    spikeMaxUsdtUnits: parseUnits(env.SPIKE_MAX_USDT, USDT_DECIMALS),
    gasDripWei: parseUnits(env.GAS_DRIP_AMOUNT_POL, POL_DECIMALS),
  }))

export type Env = z.infer<typeof envSchema>

const DEFAULT_POLYGON_RPC_URLS = 'https://polygon-bor-rpc.publicnode.com,https://polygon.drpc.org'

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // `KEY=` in a .env file means "not set", not "set to an empty string".
  const present = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  )
  const parsed = envSchema.safeParse({
    ...present,
    POLYGON_RPC_URLS: present.POLYGON_RPC_URLS ?? DEFAULT_POLYGON_RPC_URLS,
  })
  if (!parsed.success) {
    // Names only: values may be secrets.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`)
  }
  return parsed.data
}
