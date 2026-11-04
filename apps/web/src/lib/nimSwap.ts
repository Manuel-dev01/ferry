// NIM → USDT through LendaSwap: a Lightning hold invoice that Nimiq Pay pays from NIM, and a
// Polygon HTLC that releases USDT to the user's own address once this device reveals the secret.
// The swap keys and secrets live only in this browser's IndexedDB, so Ferry's server never holds
// anything that could move the money. If the claim never happens, the Lightning payment fails back.
import type { Client } from '@lendasat/lendaswap-sdk-pure'
import type { Address } from 'viem'

let clientPromise: Promise<Client> | null = null

/** Loaded on first use only: the SDK is large and only this flow needs it. */
function swapClient(): Promise<Client> {
  clientPromise ??= (async () => {
    const { Client, IdbSwapStorage, IdbWalletStorage } =
      await import('@lendasat/lendaswap-sdk-pure')
    return Client.builder()
      .withSignerStorage(new IdbWalletStorage())
      .withSwapStorage(new IdbSwapStorage())
      .build()
  })().catch((err: unknown) => {
    clientPromise = null
    throw err
  })
  return clientPromise
}

async function assets() {
  const { Asset } = await import('@lendasat/lendaswap-sdk-pure')
  return { source: Asset.BTC_LIGHTNING, target: Asset.USDT_POLYGON }
}

export interface NimSwapQuote {
  /** Sats the Lightning invoice will ask for, fees included. */
  sats: number
  feeSats: number
  minSats: number
  maxSats: number
}

/** What a USDT amount costs in sats. No approval, nothing created. */
export async function quoteNimSwap(usdtUnits: bigint): Promise<NimSwapQuote> {
  const client = await swapClient()
  const { source, target } = await assets()
  type Chain = Parameters<Client['getQuote']>[0]['sourceChain']
  const q = await client.getQuote({
    sourceChain: source.chain as Chain,
    sourceToken: source.tokenId,
    targetChain: target.chain as Chain,
    targetToken: target.tokenId,
    targetAmount: Number(usdtUnits),
  })
  return {
    sats: Number(q.source_amount),
    feeSats: q.protocol_fee + q.network_fee,
    minSats: q.min_amount,
    maxSats: q.max_amount,
  }
}

export interface NimSwap {
  id: string
  invoice: string
  sats: number
  /** Unix seconds after which the invoice can no longer be paid. */
  invoiceExpiresAt: number
}

/** Creates the swap and its invoice. Nothing is paid until the user approves in Nimiq Pay. */
export async function createNimSwap(usdtUnits: bigint, to: Address): Promise<NimSwap> {
  const client = await swapClient()
  const { source, target } = await assets()
  const { response } = await client.createSwap({
    source,
    target,
    targetAmount: Number(usdtUnits),
    targetAddress: to,
  })
  const r = response as {
    id: string
    bolt11_invoice?: string
    source_amount?: string | number
    invoice_expires_at?: number
  }
  if (!r.bolt11_invoice) throw new Error('The swap came back without an invoice')
  return {
    id: r.id,
    invoice: r.bolt11_invoice,
    sats: Number(r.source_amount ?? 0),
    invoiceExpiresAt: r.invoice_expires_at ?? 0,
  }
}

export type NimSwapStage =
  | 'checking' // an unfamiliar provider status is not proof of failure
  | 'waiting_payment' // invoice not paid yet
  | 'paid' // Lightning payment seen, USDT not locked yet
  | 'ready' // USDT locked on Polygon: claim now
  | 'claiming'
  | 'done'
  | 'failed' // expired or refunded: no USDT, and the Lightning payment fails back

export interface NimSwapState {
  stage: NimSwapStage
  status: string
  claimTx: string | null
}

const STAGES: Record<string, NimSwapStage> = {
  pending: 'waiting_payment',
  clientfundingseen: 'paid',
  clientfunded: 'paid',
  serverfunded: 'ready',
  clientredeeming: 'claiming',
  clientredeemed: 'done',
  serverredeemed: 'done',
  clientrefunded: 'failed',
  clientfundedserverrefunded: 'failed',
  clientrefundedserverfunded: 'failed',
  clientrefundedserverrefunded: 'failed',
  expired: 'failed',
  clientinvalidfunded: 'failed',
  clientfundedtoolate: 'failed',
  serverwontfund: 'failed',
}

export const nimSwapStage = (status: string): NimSwapStage => STAGES[status] ?? 'checking'

export async function nimSwapState(id: string): Promise<NimSwapState> {
  const client = await swapClient()
  const s = (await client.getSwap(id, { updateStorage: true })) as {
    status: string
    evm_claim_txid?: string | null
  }
  return {
    stage: nimSwapStage(s.status),
    status: s.status,
    claimTx: s.evm_claim_txid ?? null,
  }
}

/** Reveals the secret so the USDT goes to the address fixed at creation. Gasless; no approval. */
export async function claimNimSwap(id: string): Promise<string | null> {
  const client = await swapClient()
  const result = await client.claim(id)
  if (!result.success && !/already claimed/i.test(result.message)) {
    throw new Error(result.message || 'The claim did not go through')
  }
  return result.txHash || null
}
