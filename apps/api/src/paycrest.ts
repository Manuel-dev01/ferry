import type { CorridorCurrency, Institution } from '@ferry/shared'
import { institutionTypeSchema } from '@ferry/shared'
import { keccak256, toHex } from 'viem'
import { z } from 'zod'
import { HttpError } from './errors'
import type { FetchLike } from './lightning'

const TIMEOUT_MS = 10_000
const INSTITUTIONS_TTL_MS = 24 * 60 * 60_000
const RATE_TTL_MS = 10_000
const POSITIVE_DECIMAL = /^(?!0+(?:\.0+)?$)\d+(?:\.\d+)?$/

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ status: z.string().optional(), message: z.string().optional(), data })

const institutionsSchema = envelope(
  z.array(z.object({ code: z.string(), name: z.string(), type: z.string() })),
)
const rateSchema = envelope(
  z.object({
    sell: z
      .object({
        rate: z.union([z.string(), z.number()]),
        providerIds: z.array(z.string()).optional(),
      })
      .optional(),
  }),
)

/** Paycrest calls that need no API key: institutions and rates. Always live. */
export class PaycrestPublic {
  private institutionsCache = new Map<string, { at: number; value: Institution[] }>()
  private rateCache = new Map<string, { at: number; value: string | null }>()

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly baseUrl: string,
  ) {}

  private async get(path: string): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new HttpError(
        503,
        'PAYCREST_UNREACHABLE',
        'Our payout partner is unreachable right now',
      )
    }
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) return { __status: res.status, body }
    return body
  }

  async institutions(currency: CorridorCurrency): Promise<Institution[]> {
    const hit = this.institutionsCache.get(currency)
    if (hit && Date.now() - hit.at < INSTITUTIONS_TTL_MS) return hit.value
    const parsed = institutionsSchema.safeParse(await this.get(`/v1/institutions/${currency}`))
    if (!parsed.success) {
      throw new HttpError(502, 'PAYCREST_BAD_RESPONSE', "We couldn't load the list of banks")
    }
    const value = parsed.data.data
      .map((i) => ({ ...i, type: institutionTypeSchema.safeParse(i.type).data }))
      .filter((i): i is Institution => i.type !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name))
    this.institutionsCache.set(currency, { at: Date.now(), value })
    return value
  }

  /** The sell rate for `wholeUsdt`, or null when no provider serves the corridor right now. */
  async sellRate(currency: CorridorCurrency, wholeUsdt: bigint): Promise<string | null> {
    const key = `${currency}:${wholeUsdt}`
    const hit = this.rateCache.get(key)
    if (hit && Date.now() - hit.at < RATE_TTL_MS) return hit.value
    const raw = await this.get(`/v2/rates/polygon/USDT/${wholeUsdt}/${currency}`)
    const parsed = rateSchema.safeParse(raw)
    const rate = parsed.success && parsed.data.data.sell ? String(parsed.data.data.sell.rate) : null
    const value = rate && POSITIVE_DECIMAL.test(rate) ? rate : null
    this.rateCache.set(key, { at: Date.now(), value })
    return value
  }
}

/** Calls that need a KYB-verified API key. The mock stands in until the key exists. */
export interface PaycrestKeyed {
  readonly mode: 'mock' | 'live'
  verifyAccount(institution: string, accountIdentifier: string): Promise<string>
}

const MOCK_NAMES = [
  'ADA OBI',
  'CHIDI OKAFOR',
  'AMINA BELLO',
  'WANJIRU KAMAU',
  'TUNDE ADEYEMI',
  'GRACE AUMA',
  'IBRAHIM MUSA',
  'NGOZI EZE',
]

/**
 * Deterministic stand-in for Paycrest's keyed endpoints. Account numbers ending in 0000 are
 * "not found" and ones ending in 9999 make the name check "unavailable", so every UI state
 * can be exercised.
 */
export class PaycrestMock implements PaycrestKeyed {
  readonly mode = 'mock' as const

  async verifyAccount(institution: string, accountIdentifier: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 400))
    if (accountIdentifier.endsWith('0000')) {
      throw new HttpError(404, 'ACCOUNT_NOT_FOUND', "We couldn't find that account")
    }
    if (accountIdentifier.endsWith('9999')) {
      throw new HttpError(503, 'NAME_CHECK_UNAVAILABLE', "We can't check names right now")
    }
    const h = keccak256(toHex(`${institution}:${accountIdentifier}`))
    return MOCK_NAMES[Number.parseInt(h.slice(2, 6), 16) % MOCK_NAMES.length]!
  }
}
