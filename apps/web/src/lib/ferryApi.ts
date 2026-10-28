import type {
  CorridorCurrency,
  CreateOfframpRequest,
  CreateOfframpResponse,
  GasTopupResponse,
  HandoffResponse,
  Institution,
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
    api<GasTopupResponse>('/v1/gas', { method: 'POST', body: { address } }),

  /** Records the user's transfer to Fonbnk once it is on-chain; 'pending' until then. */
  handoff: (body: { txHash: Hex; currency: CorridorCurrency; channel: string }) =>
    api<HandoffResponse>('/v1/handoffs', { method: 'POST', body: { ...body, provider: 'fonbnk' } }),

  order: (orderId: string, clientSecret: string) =>
    api<OrderView>(`/v1/orders/${orderId}`, { headers: { 'X-Client-Secret': clientSecret } }),
}
