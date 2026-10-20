import { z } from 'zod'

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

// ---- Spike S2: gasless USDT ----

export const spikeConfigResponseSchema = z.object({
  recipient: evmAddressSchema,
  maxUsdt: unitsSchema,
  relayer: z.object({ address: evmAddressSchema, pol: unitsSchema }).nullable(),
  gasDrip: z.object({ enabled: z.boolean(), amountWei: unitsSchema }),
  lnMaxSats: z.number().int(),
})
export type SpikeConfigResponse = z.infer<typeof spikeConfigResponseSchema>

export const spikeNonceResponseSchema = z.object({ nonce: unitsSchema })

export const spikeRelayRequestSchema = z.object({
  from: evmAddressSchema,
  nonce: unitsSchema,
  functionSignature: hexSchema,
  signature: hexSchema,
})
export type SpikeRelayRequest = z.input<typeof spikeRelayRequestSchema>

/** `pending`: broadcast but not mined yet. `unknown`: broadcast outcome unclear; never re-sign. */
export const txStatusSchema = z.enum(['success', 'reverted', 'pending', 'unknown'])
export type TxStatus = z.infer<typeof txStatusSchema>

export const spikeTxResponseSchema = z.object({
  txHash: hexSchema,
  status: txStatusSchema,
})
export type SpikeTxResponse = z.infer<typeof spikeTxResponseSchema>

export const spikeGasDripRequestSchema = z.object({ address: evmAddressSchema })

export const spikeGasDripResponseSchema = z.object({
  status: z.enum(['sent', 'already_funded']),
  txHash: hexSchema.nullable(),
  txStatus: txStatusSchema.nullable(),
})
export type SpikeGasDripResponse = z.infer<typeof spikeGasDripResponseSchema>

// ---- Spike S3: Lightning ----

export const lightningAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/, 'Expected a Lightning address (name@domain)')

export const spikeLnurlRequestSchema = z.object({
  address: lightningAddressSchema,
  sats: z.number().int().positive(),
})

export const spikeLnurlResponseSchema = z.object({
  invoice: z.string(),
  paymentHash: z.string(),
  amountMsat: unitsSchema,
  expiresAt: z.number().int(),
  hasVerify: z.boolean(),
  limits: z.object({ minSendableMsat: unitsSchema, maxSendableMsat: unitsSchema }),
})
export type SpikeLnurlResponse = z.infer<typeof spikeLnurlResponseSchema>

export const spikeLnVerifyResponseSchema = z.object({
  settled: z.boolean(),
  checkedAt: z.number().int(),
})

/** What the host returned from payLightningInvoice, reported back for the record. */
export const spikeLnOutcomeRequestSchema = z.object({
  paymentHash: z.string().regex(/^[0-9a-f]{64}$/),
  outcome: z.enum(['submitted', 'error']),
  errorType: z.string().max(64).optional(),
  hash: z.string().max(200).optional(),
  swapId: z.string().max(200).optional(),
})

// ---- Spike S4: Nimiq sign-in ----

export const spikeNimChallengeResponseSchema = z.object({
  challenge: z.string(),
})

export const spikeNimVerifyRequestSchema = z.object({
  challenge: z.string().min(1),
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
})

export const spikeNimVerifyResponseSchema = z.object({
  valid: z.boolean(),
  scheme: z.enum(['raw', 'prefixed']).nullable(),
  address: z.string().nullable(),
})
export type SpikeNimVerifyResponse = z.infer<typeof spikeNimVerifyResponseSchema>
