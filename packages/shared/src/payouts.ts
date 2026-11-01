import { z } from 'zod'
import { FONBNK_COUNTRY_CODES, type FonbnkCountry } from './fonbnk'

/**
 * Ways to deliver a cash-out. Each is a partner the user's wallet pays directly; Ferry never
 * holds the money.
 * - fonbnk: hosted form, then a USDT transfer to Fonbnk's deposit address.
 * - mpesa_ln: a Kenyan phone number's Lightning address (Tando, bitcoin.co.ke), paid with
 *   payLightningInvoice from NIM or USDT. One screen, delivery confirmed with an M-Pesa receipt.
 * - mavapay_ln: the user's own Mavapay Money Lightning address, which pays out to the bank
 *   account linked to it. One screen, but it needs a Mavapay Money account.
 */
export const payoutRouteSchema = z.enum(['fonbnk', 'mpesa_ln', 'mavapay_ln'])
export type PayoutRoute = z.infer<typeof payoutRouteSchema>

const countrySchema = z.enum(FONBNK_COUNTRY_CODES as [FonbnkCountry, ...FonbnkCountry[]])

export const offersQuerySchema = z.object({
  country: countrySchema,
  channel: z.string().min(1),
  /** USDT base units, as a string. */
  units: z.string().regex(/^\d+$/),
})

export const offerSchema = z.object({
  route: payoutRouteSchema,
  /** What the recipient gets, in whole currency units as a decimal string (e.g. "6831"). */
  receive: z.string(),
  currency: z.string(),
  /** Local currency per 1 USDT, as a decimal string. */
  rate: z.string(),
  /** Partner fee in local currency, when known. */
  fee: z.string().nullable(),
  /**
   * True when the amount is Ferry's estimate rather than the partner's quote. Lightning routes
   * are paid through Nimiq Pay's own swap, whose fee it shows before the user approves.
   */
  estimate: z.boolean(),
  recommended: z.boolean(),
})
export type Offer = z.infer<typeof offerSchema>

export const offersResponseSchema = z.object({ offers: z.array(offerSchema) })
export type OffersResponse = z.infer<typeof offersResponseSchema>

export const mpesaInvoiceRequestSchema = z.object({
  phone: z.string().min(9).max(16),
  /** Whole shillings. */
  kes: z.number().int().positive(),
})

export const mavapayInvoiceRequestSchema = z.object({
  address: z.string().regex(/^[a-z0-9._-]+@mavapay\.money$/i, 'Expected name@mavapay.money'),
  units: z.string().regex(/^\d+$/),
})

export const lnInvoiceResponseSchema = z.object({
  invoice: z.string(),
  paymentHash: z.string(),
  sats: z.number().int(),
  /** Unix seconds. */
  expiresAt: z.number().int(),
  /** What the recipient should get, in whole local currency units, when known. */
  receive: z.string().nullable(),
  currency: z.string(),
})
export type LnInvoiceResponse = z.infer<typeof lnInvoiceResponseSchema>

export const mpesaStatusResponseSchema = z.object({
  status: z.enum(['unknown', 'pending', 'completed']),
  /** The M-Pesa confirmation code, once delivered. */
  receipt: z.string().nullable(),
  kes: z.number().nullable(),
})
export type MpesaStatusResponse = z.infer<typeof mpesaStatusResponseSchema>

/** Where Tando shows a payment's M-Pesa receipt, for a "View receipt" link. */
export const mpesaReceiptUrl = (paymentHash: string) =>
  `https://bitcoin.co.ke/receipt/${paymentHash}`

/** Kenya's M-Pesa Lightning addresses: every phone number has one. */
export const mpesaLightningAddress = (normalizedPhone: string) => `${normalizedPhone}@bitcoin.co.ke`
