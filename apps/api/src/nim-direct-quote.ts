import { formatNim, parseUnits, USDT0_ADDRESS } from '@ferry/shared'
import { z } from 'zod'
import type { FetchLike } from './lightning'

// Research adapter: read-only methods only. No exchange orders or wallet payments.
type Method = 'getCurrenciesFull' | 'getPairs' | 'getMinAmount' | 'getExchangeAmount'
const READ_METHODS = new Set<Method>([
  'getCurrenciesFull',
  'getPairs',
  'getMinAmount',
  'getExchangeAmount',
])
const assetSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  inboundEnabled: z.boolean().optional(),
  outboundEnabled: z.boolean().optional(),
  enabledFrom: z.boolean().optional(),
  enabledTo: z.boolean().optional(),
  precision: z.number().int(),
  blockchain: z.string().nullish(),
  protocol: z.string().nullish(),
  contractAddress: z.string().nullish(),
})
type Asset = z.infer<typeof assetSchema>

export class DirectQuoteError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function enabled(a: Asset, direction: 'in' | 'out') {
  const flags =
    direction === 'in' ? [a.inboundEnabled, a.enabledFrom] : [a.outboundEnabled, a.enabledTo]
  return a.enabled && flags.includes(true) && !flags.includes(false)
}

/** Reject a guessed ticker: require the exact Polygon contract and network metadata. */
export function selectDirectPair(raw: unknown): { from: string; to: string } {
  const parsed = z.array(z.unknown()).safeParse(raw)
  if (!parsed.success) throw new DirectQuoteError('INVALID_ASSET_METADATA')
  const assets = parsed.data.flatMap((a) => {
    const result = assetSchema.safeParse(a)
    return result.success ? [result.data] : []
  })
  const source = assets.find(
    (a) =>
      a.name.toLowerCase() === 'nim' &&
      a.precision === 5 &&
      !a.contractAddress &&
      enabled(a, 'in') &&
      (!a.blockchain || /^(nim|nimiq)$/i.test(a.blockchain)),
  )
  const targets = assets.filter(
    (a) =>
      a.precision === 6 &&
      enabled(a, 'out') &&
      a.contractAddress?.toLowerCase() === USDT0_ADDRESS.toLowerCase() &&
      [a.blockchain, a.protocol].some((v) => !!v && /^(polygon|matic|mrc20|137)$/i.test(v)),
  )
  if (!source || targets.length !== 1) throw new DirectQuoteError('PAIR_NOT_VERIFIED')
  return { from: source.name, to: targets[0]!.name }
}

/** Provider minimums round up to Luna; estimated receipts round down to USDT base units. */
function decimalUnits(raw: unknown, decimals: number, roundUp: boolean): bigint {
  if (typeof raw !== 'string' || !/^\d{1,30}(?:\.\d{1,30})?$/.test(raw)) {
    throw new DirectQuoteError('INVALID_DECIMAL_AMOUNT')
  }
  const [whole, fraction = ''] = raw.split('.')
  const kept = fraction.slice(0, decimals)
  const units = parseUnits(`${whole}.${kept.padEnd(decimals, '0')}`, decimals)
  return units + (roundUp && /[1-9]/.test(fraction.slice(decimals)) ? 1n : 0n)
}

export async function verifyDirectNimQuote(
  key: string | undefined,
  luna: bigint,
  fetchImpl: FetchLike = globalThis.fetch,
) {
  if (!key?.trim()) throw new DirectQuoteError('API_KEY_REQUIRED')
  if (luna <= 0n || luna > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DirectQuoteError('INVALID_NIM_AMOUNT')
  }
  async function read(method: Method, params: Record<string, string>) {
    if (!READ_METHODS.has(method)) throw new DirectQuoteError('READ_ONLY_METHOD_REQUIRED')
    let response: Response
    try {
      response = await fetchImpl('https://api.changehero.io/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': key!.trim() },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'ferry-quote-check', method, params }),
        signal: AbortSignal.timeout(12_000),
        redirect: 'error', // Never forward a partner credential to a redirect target.
      })
    } catch {
      throw new DirectQuoteError('PROVIDER_UNAVAILABLE')
    }
    if (!response.ok) throw new DirectQuoteError('PROVIDER_HTTP_ERROR')
    const parsed = z
      .object({
        jsonrpc: z.literal('2.0'),
        id: z.literal('ferry-quote-check'),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      })
      .safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new DirectQuoteError('PROVIDER_BAD_RESPONSE')
    if (parsed.data.error != null) throw new DirectQuoteError('PROVIDER_REJECTED_REQUEST')
    return parsed.data.result
  }
  const pair = selectDirectPair(await read('getCurrenciesFull', {}))
  // Asset support alone does not mean this partner is allowed to trade the pair.
  const pairs = z
    .array(z.object({ from: z.string(), to: z.string() }))
    .safeParse(await read('getPairs', {}))
  if (!pairs.success) throw new DirectQuoteError('INVALID_PAIR_METADATA')
  if (
    !pairs.data.some(
      (p) =>
        p.from.toLowerCase() === pair.from.toLowerCase() &&
        p.to.toLowerCase() === pair.to.toLowerCase(),
    )
  ) {
    throw new DirectQuoteError('PAIR_NOT_ENABLED')
  }
  const minimumLuna = decimalUnits(await read('getMinAmount', pair), 5, true)
  if (minimumLuna <= 0n) throw new DirectQuoteError('INVALID_MINIMUM')
  if (luna < minimumLuna) return { available: false as const, pair, minimumLuna }
  const estimatedUsdtUnits = decimalUnits(
    await read('getExchangeAmount', {
      ...pair,
      amount: formatNim(luna),
    }),
    6,
    false,
  )
  if (estimatedUsdtUnits <= 0n) throw new DirectQuoteError('INVALID_ESTIMATE')
  return { available: true as const, pair, minimumLuna, estimatedUsdtUnits }
}
