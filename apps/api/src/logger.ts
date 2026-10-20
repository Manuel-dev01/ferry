import pino from 'pino'

// Fields that are secrets or PII, redacted at the top level and up to two levels deep.
const SENSITIVE_KEYS = [
  'accountIdentifier',
  'accountName',
  'phone',
  'kyc',
  'signature',
  'clientSecret',
  'privateKey',
  'authorization',
  'cookie',
]

export const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  'req.headers["x-client-secret"]',
  'req.headers["api-key"]',
]

export function createLogger(level: string, pretty = false) {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  })
}

export type Logger = ReturnType<typeof createLogger>
