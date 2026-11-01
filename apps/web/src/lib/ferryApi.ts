import type {
  CorridorCurrency,
  CreateOfframpRequest,
  CreateOfframpResponse,
  FonbnkCountry,
  GasTopupResponse,
  HandoffResponse,
  Institution,
  LnInvoiceResponse,
  MavapayStatusResponse,
  MpesaStatusResponse,
  OffersResponse,
  OrderView,
  QuoteResponse,
  VerifyAccountResponse,
} from '@ferry/shared'
import type { Hex } from 'viem'
import { api } from './api'

export const ferryApi = {
  institutions: (currency: CorridorCurrency) => api<Institution[]>(`/v1/institutions/${currency}`),

  quote: (currency: CorridorCurrency, amount: string, amountIn: 'usdt' | 'fiat') =>
    api<QuoteResponse>(
      `/v1/quote?${new URLSearchParams({ currency, amount, amountIn }).toString()}`,
    ),

  verifyAccount: (currency: CorridorCurrency, institution: string, accountIdentifier: string) =>
    api<VerifyAccountResponse>('/v1/accounts/verify', {
      method: 'POST',
      body: { currency, institution, accountIdentifier },
    }),

  createOfframp: (body: CreateOfframpRequest) =>
    api<CreateOfframpResponse>('/v1/orders/offramp', { method: 'POST', body }),

  submitSignature: (orderId: string, clientSecret: string, signature: Hex) =>
    api<OrderView>(`/v1/orders/${orderId}/signature`, {
      method: 'POST',
      body: { signature },
      headers: { 'X-Client-Secret': clientSecret },
    }),

  gasTopup: (address: string) =>
    // The server waits for the top-up's receipt (up to 60 s) before answering.
    api<GasTopupResponse>('/v1/gas', { method: 'POST', body: { address }, timeoutMs: 75_000 }),

  /** Records the user's transfer to Fonbnk once it is on-chain; 'pending' until then. */
  handoff: (body: { txHash: Hex; country: FonbnkCountry; channel: string }) =>
    api<HandoffResponse>('/v1/handoffs', { method: 'POST', body: { ...body, provider: 'fonbnk' } }),

  /** The sender says the payout arrived; feeds the median time on Proof of Ferry. */
  handoffReceived: (txHash: Hex) =>
    api<HandoffResponse>(`/v1/handoffs/${txHash}/received`, { method: 'POST' }),

  /** Every route that can deliver this cash-out, each with its own quote. */
  offers: (country: FonbnkCountry, channel: string, units: bigint) =>
    api<OffersResponse>(
      `/v1/offers?${new URLSearchParams({ country, channel, units: units.toString() }).toString()}`,
    ),

  /** An invoice from a Kenyan number's M-Pesa Lightning address; `kes` is what arrives. */
  mpesaInvoice: (phone: string, kes: number) =>
    api<LnInvoiceResponse>('/v1/ln/mpesa', { method: 'POST', body: { phone, kes } }),

  mpesaStatus: (paymentHash: string) => api<MpesaStatusResponse>(`/v1/ln/mpesa/${paymentHash}`),

  /** An invoice from the user's own Mavapay Money address, sized from a USDT amount. */
  mavapayInvoice: (address: string, units: bigint) =>
    api<LnInvoiceResponse>('/v1/ln/mavapay', {
      method: 'POST',
      body: { address, units: units.toString() },
    }),

  mavapayStatus: (paymentHash: string) =>
    api<MavapayStatusResponse>(`/v1/ln/mavapay/${paymentHash}`),

  order: (orderId: string, clientSecret: string) =>
    api<OrderView>(`/v1/orders/${orderId}`, { headers: { 'X-Client-Secret': clientSecret } }),
}
