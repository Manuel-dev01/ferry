import { parseUnits, percentToBps, POL_DECIMALS, USDT0_ADDRESS, USDT_DECIMALS } from '@ferry/shared'
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

    PAYCREST_MODE: z.enum(['mock', 'live']).default('mock'),
    PAYCREST_BASE_URL: z.string().url().default('https://api.paycrest.io'),
    PAYCREST_API_KEY: z.string().optional(),
    PAYCREST_API_SECRET: z.string().optional(),
    FERRY_FEE_PERCENT: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .default('0.5'),
    LIMIT_MIN_USD: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .default('1'),
    LIMIT_MAX_USD: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .default('200'),
    LIMIT_DAILY_USD: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .default('500'),
    /** Comma-separated corridor currencies that accept new orders. */
    CORRIDORS_ENABLED: csv
      .pipe(z.array(z.enum(['NGN', 'KES', 'UGX', 'TZS'])))
      .default(['NGN', 'KES', 'UGX', 'TZS']),

    SPIKES_ENABLED: bool('false'),
    SPIKE_ALLOWED_RECIPIENT: address.optional(),
    SPIKE_MAX_USDT: z.string().default('1'),
    SPIKE_MAX_RELAYS: z.coerce.number().int().nonnegative().default(10),
    SPIKE_LN_MAX_SATS: z.coerce.number().int().positive().default(2000),
    SPIKE_GATEWAY_MIN_USDT: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .default('0.5'),
    SPIKE_GATEWAY_MAX_USDT: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .default('2'),
    /** Hosted demo only: lets the simulated order engine run with NODE_ENV=production. */
    ALLOW_MOCK_ORDERS: bool('false'),
    GAS_DRIP_ENABLED: bool('false'),
    GAS_DRIP_AMOUNT_POL: z.string().default('0.02'),
    GAS_DRIP_MAX_TOTAL: z.coerce.number().int().nonnegative().default(5),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Required in production' })
    }
    if (env.PAYCREST_MODE === 'live' && (!env.PAYCREST_API_KEY || !env.PAYCREST_API_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYCREST_API_KEY'],
        message: 'PAYCREST_API_KEY and PAYCREST_API_SECRET are required when PAYCREST_MODE=live',
      })
    }
    if (env.NODE_ENV === 'production' && env.PAYCREST_MODE === 'mock' && !env.ALLOW_MOCK_ORDERS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYCREST_MODE'],
        message: 'mock is not allowed in production unless ALLOW_MOCK_ORDERS=true',
      })
    }
  })
  .transform((env) => ({
    ...env,
    spikeMaxUsdtUnits: parseUnits(env.SPIKE_MAX_USDT, USDT_DECIMALS),
    gasDripWei: parseUnits(env.GAS_DRIP_AMOUNT_POL, POL_DECIMALS),
    spikeGatewayMinUnits: parseUnits(env.SPIKE_GATEWAY_MIN_USDT, USDT_DECIMALS),
    spikeGatewayMaxUnits: parseUnits(env.SPIKE_GATEWAY_MAX_USDT, USDT_DECIMALS),
    ferryFeeBps: percentToBps(env.FERRY_FEE_PERCENT),
    // USDT is treated as 1:1 with USD for limits.
    limits: {
      minUnits: parseUnits(env.LIMIT_MIN_USD, USDT_DECIMALS),
      maxUnits: parseUnits(env.LIMIT_MAX_USD, USDT_DECIMALS),
      dailyUnits: parseUnits(env.LIMIT_DAILY_USD, USDT_DECIMALS),
    },
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
