import { z } from 'zod'
import { FONBNK_COUNTRY_CODES, type FonbnkCountry } from './fonbnk'

export const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Expected an EVM address')
  .transform((v) => v as `0x${string}`)

export const hexSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/, 'Expected 0x-prefixed hex bytes')
  .transform((v) => v as `0x${string}`)

/** Base-unit integers travel as decimal strings in JSON. */
export const unitsSchema = z.string().regex(/^\d+$/, 'Expected an integer string')

/** Every API error body. `ref` is a short support ID safe to show users. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    ref: z.string().optional(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const balancesResponseSchema = z.object({
  address: evmAddressSchema,
  usdt: unitsSchema,
  pol: unitsSchema,
})
export type BalancesResponse = z.infer<typeof balancesResponseSchema>

// ---- v1: cash-out ----

export const corridorCurrencySchema = z.enum(['NGN', 'KES', 'UGX', 'TZS'])
export const institutionTypeSchema = z.enum(['bank', 'mobile_money'])

export const metaResponseSchema = z.object({
  corridors: z.array(
    z.object({
      currency: corridorCurrencySchema,
      country: z.string(),
      name: z.string(),
      enabled: z.boolean(),
    }),
  ),
  limits: z.object({ minUsd: z.string(), maxUsd: z.string(), dailyUsd: z.string() }),
  fees: z.object({ ferryFeeBps: z.number().int(), firstOrderFree: z.boolean() }),
  features: z.object({ lightning: z.boolean(), onramp: z.boolean(), testDrive: z.boolean() }),
  paycrestMode: z.enum(['mock', 'live']),
  payoutRoute: z.enum(['fonbnk', 'paycrest']),
  gasTopup: z.boolean(),
  relayer: evmAddressSchema.nullable(),
})
export type MetaResponse = z.infer<typeof metaResponseSchema>

// ---- Gas top-up and partner hand-offs ----

export const gasTopupRequestSchema = z.object({ address: evmAddressSchema })
export const gasTopupResponseSchema = z.object({
  status: z.enum(['sent', 'already_funded', 'pending', 'reverted', 'unknown']),
  txHash: hexSchema.nullable(),
})
export type GasTopupResponse = z.infer<typeof gasTopupResponseSchema>

export const fonbnkChannelSchema = z.enum([
  'bank',
  'mobile_money',
  'paybill',
  'buy_goods',
  'airtime',
])

export const fonbnkCountrySchema = z.enum(
  FONBNK_COUNTRY_CODES as [FonbnkCountry, ...FonbnkCountry[]],
)

/** `currency` alone is the older form from before the country list grew; it still works. */
export const handoffRequestSchema = z
  .object({
    txHash: hexSchema,
    provider: z.literal('fonbnk'),
    country: fonbnkCountrySchema.optional(),
    currency: corridorCurrencySchema.optional(),
    channel: fonbnkChannelSchema,
  })
  .refine((b) => b.country || b.currency, { message: 'country is required', path: ['country'] })
export const handoffResponseSchema = z.object({
  status: z.enum(['pending', 'reverted', 'confirmed']),
  txHash: hexSchema,
  amountUnits: unitsSchema.nullable(),
  toAddress: evmAddressSchema.nullable(),
})
export type HandoffResponse = z.infer<typeof handoffResponseSchema>

/** A NIM → USDT swap (LendaSwap) to count on Proof of Ferry, once it completed. */
export const nimSwapRequestSchema = z.object({
  swapId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
})
export const nimSwapResponseSchema = z.object({
  status: z.enum(['pending', 'confirmed']),
  amountUnits: unitsSchema.nullable(),
})
export type NimSwapResponse = z.infer<typeof nimSwapResponseSchema>

export const institutionSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: institutionTypeSchema,
})
export type Institution = z.infer<typeof institutionSchema>

export const quoteResponseSchema = z.object({
  currency: corridorCurrencySchema,
  rate: z.string(),
  amountUnits: unitsSchema,
  ferryFeeUnits: unitsSchema,
  youSendUnits: unitsSchema,
  theyReceiveMinor: unitsSchema,
  validForSeconds: z.number().int(),
  fetchedAt: z.number().int(),
})
export type QuoteResponse = z.infer<typeof quoteResponseSchema>

export const verifyAccountRequestSchema = z.object({
  currency: corridorCurrencySchema,
  institution: z.string().min(1).max(32),
  accountIdentifier: z.string().min(5).max(32),
})

export const verifyAccountResponseSchema = z.object({
  accountName: z.string(),
  masked: z.string(),
})
export type VerifyAccountResponse = z.infer<typeof verifyAccountResponseSchema>

export const createOfframpRequestSchema = z.object({
  currency: corridorCurrencySchema,
  institution: z.string().min(1).max(32),
  accountIdentifier: z.string().min(5).max(32),
  accountName: z.string().min(1).max(120),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  amountIn: z.enum(['usdt', 'fiat']),
  evmAddress: evmAddressSchema,
  recipientKind: z.enum(['self', 'other']),
})
export type CreateOfframpRequest = z.input<typeof createOfframpRequestSchema>

export const orderTimelineEntrySchema = z.object({ status: z.string(), at: z.number().int() })

export const orderViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['usdt_offramp', 'test_drive']),
  status: z.string(),
  currency: corridorCurrencySchema,
  institutionName: z.string(),
  recipientMasked: z.string(),
  amountUnits: unitsSchema,
  ferryFeeUnits: unitsSchema,
  amountToTransferUnits: unitsSchema,
  theyReceiveMinor: unitsSchema,
  rate: z.string(),
  receiveAddress: evmAddressSchema,
  refundAddress: evmAddressSchema,
  validUntil: z.number().int(),
  polygonTxHash: z.string().nullable(),
  createdAt: z.number().int(),
  settledAt: z.number().int().nullable(),
  timeline: z.array(orderTimelineEntrySchema),
  mock: z.boolean(),
})
export type OrderView = z.infer<typeof orderViewSchema>

export const createOfframpResponseSchema = z.object({
  orderId: z.string(),
  clientSecret: z.string(),
  order: orderViewSchema,
  signing: z.object({
    mode: z.literal('metatx'),
    typedData: z.unknown(),
    message: z.object({ nonce: unitsSchema, from: evmAddressSchema, functionSignature: hexSchema }),
  }),
})
export type CreateOfframpResponse = z.infer<typeof createOfframpResponseSchema>

export const submitSignatureRequestSchema = z.object({ signature: hexSchema })

// ---- Proof of Ferry ----

/**
 * Counts only cash-outs Ferry can see on-chain: a wallet's own USDT transfer to the payout
 * partner. "Confirmed" means the sender told Ferry the money arrived; partners report nothing.
 */
export const statsResponseSchema = z.object({
  cashouts: z.number().int(),
  confirmedPaid: z.number().int(),
  uniqueWallets: z.number().int(),
  countries: z.number().int(),
  volumeUnits: unitsSchema,
  /** Sent to confirmed arrival, median over confirmed cash-outs. */
  medianSeconds: z.number().nullable(),
  byCountry: z.array(
    z.object({
      country: fonbnkCountrySchema,
      cashouts: z.number().int(),
      volumeUnits: unitsSchema,
    }),
  ),
  /** NIM → USDT swaps done in Ferry: NIM turned into money the user can cash out. */
  nimSwaps: z.object({ count: z.number().int(), volumeUnits: unitsSchema }),
  latest: z.array(
    z.object({
      country: fonbnkCountrySchema,
      channel: fonbnkChannelSchema,
      amountUnits: unitsSchema,
      /** How it was delivered: an on-chain Fonbnk hand-off or an M-Pesa Direct payout. */
      route: z.enum(['fonbnk', 'mpesa_ln']),
      /** The proof: a Polygonscan transaction or the M-Pesa receipt page. */
      link: z.string().url(),
      at: z.number().int(),
      seconds: z.number().nullable(),
    }),
  ),
  updatedAt: z.number().int(),
})
export type StatsResponse = z.infer<typeof statsResponseSchema>
