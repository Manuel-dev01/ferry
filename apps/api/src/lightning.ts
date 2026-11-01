import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { decode } from 'light-bolt11-decoder'
import { z } from 'zod'
import { HttpError } from './errors'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const FETCH_TIMEOUT_MS = 10_000
/** Reject invoices that would expire before the user can reasonably approve them. */
export const MIN_INVOICE_LIFETIME_S = 60

const lnurlErrorSchema = z.object({ status: z.literal('ERROR'), reason: z.string().optional() })

export const payRequestSchema = z
  .object({
    tag: z.literal('payRequest'),
    callback: z.string().url(),
    minSendable: z.coerce.number().int().nonnegative(),
    maxSendable: z.coerce.number().int().positive(),
    metadata: z.string(),
    commentAllowed: z.number().optional(),
  })
  .passthrough()
export type PayRequest = z.infer<typeof payRequestSchema>

export const invoiceResponseSchema = z
  .object({
    pr: z.string().min(1),
    verify: z.string().url().optional(),
    successAction: z.unknown().optional(),
    routes: z.array(z.unknown()).optional(),
  })
  .passthrough()
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>

async function fetchLnurlJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  if (!url.startsWith('https://')) {
    throw new HttpError(502, 'LNURL_INSECURE', 'The Lightning service did not use HTTPS')
  }
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
    })
  } catch {
    throw new HttpError(502, 'LNURL_UNREACHABLE', 'The Lightning service is unreachable')
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new HttpError(502, 'LNURL_BAD_RESPONSE', 'The Lightning service sent an unreadable reply')
  }
  const err = lnurlErrorSchema.safeParse(body)
  if (err.success) {
    throw new HttpError(502, 'LNURL_ERROR', 'The Lightning service refused the request', {
      reason: err.data.reason,
    })
  }
  if (!res.ok) {
    throw new HttpError(502, 'LNURL_HTTP_ERROR', `The Lightning service replied ${res.status}`)
  }
  return body
}

/** LUD-16: name@domain → https://domain/.well-known/lnurlp/name (LUD-06 payRequest). */
export function lightningAddressUrl(address: string): string {
  const at = address.lastIndexOf('@')
  const name = address.slice(0, at)
  const domain = address.slice(at + 1)
  if (at <= 0 || !domain) throw new HttpError(400, 'LN_BAD_ADDRESS', 'Not a Lightning address')
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`
}

export async function resolveLightningAddress(
  fetchImpl: FetchLike,
  address: string,
): Promise<{ payRequest: PayRequest; raw: unknown }> {
  const raw = await fetchLnurlJson(fetchImpl, lightningAddressUrl(address))
  const parsed = payRequestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(502, 'LNURL_BAD_RESPONSE', 'The Lightning address is not a pay request')
  }
  return { payRequest: parsed.data, raw }
}

export async function requestInvoice(
  fetchImpl: FetchLike,
  payRequest: PayRequest,
  amountMsat: bigint,
): Promise<{ invoice: InvoiceResponse; raw: unknown }> {
  if (amountMsat < BigInt(payRequest.minSendable) || amountMsat > BigInt(payRequest.maxSendable)) {
    throw new HttpError(
      400,
      'LN_AMOUNT_OUT_OF_RANGE',
      'Amount is outside what this address accepts',
      {
        minSendableMsat: String(payRequest.minSendable),
        maxSendableMsat: String(payRequest.maxSendable),
      },
    )
  }
  const url = new URL(payRequest.callback)
  url.searchParams.set('amount', amountMsat.toString())
  const raw = await fetchLnurlJson(fetchImpl, url.toString())
  const parsed = invoiceResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(502, 'LNURL_BAD_RESPONSE', 'The Lightning service returned no invoice')
  }
  return { invoice: parsed.data, raw }
}

export interface ValidatedInvoice {
  paymentHash: string
  amountMsat: bigint
  expiresAt: number
}

type Section = { name: string; value?: unknown }

/**
 * Checks a BOLT11 invoice against what we asked for: mainnet, exact amount, the LUD-06
 * description hash (sha256 of the metadata string), and enough lifetime left to approve it.
 */
export function validateInvoice(
  pr: string,
  expected: { amountMsat: bigint; metadata: string; nowSeconds: number },
): ValidatedInvoice {
  let sections: Section[]
  let expirySeconds: number | undefined
  try {
    const decoded = decode(pr) as { sections: Section[]; expiry?: number }
    sections = decoded.sections
    expirySeconds = decoded.expiry
  } catch {
    throw new HttpError(502, 'LN_BAD_INVOICE', 'The invoice could not be decoded')
  }
  const get = (name: string) => sections.find((s) => s.name === name)?.value

  if (!pr.toLowerCase().startsWith('lnbc') || pr.toLowerCase().startsWith('lnbcrt')) {
    throw new HttpError(502, 'LN_WRONG_NETWORK', 'The invoice is not for Bitcoin mainnet')
  }
  const amount = get('amount')
  if (amount === undefined || BigInt(String(amount)) !== expected.amountMsat) {
    throw new HttpError(502, 'LN_AMOUNT_MISMATCH', 'The invoice amount differs from the request')
  }
  // LUD-06 wants sha256(metadata) as the description hash. Some services (Tando's M-Pesa
  // addresses) put a plain description instead; that is accepted only if it names the exact
  // address from the metadata, so the invoice is still bound to the recipient we resolved.
  const descriptionHash = get('description_hash')
  const description = get('description')
  const metadataHash = bytesToHex(sha256(utf8ToBytes(expected.metadata)))
  const identifier = metadataIdentifier(expected.metadata)
  const boundByHash =
    typeof descriptionHash === 'string' && descriptionHash.toLowerCase() === metadataHash
  const boundByText =
    descriptionHash === undefined &&
    typeof description === 'string' &&
    identifier !== null &&
    new RegExp(`(^|\\s)${escapeRegExp(identifier)}($|\\s)`, 'i').test(description)
  if (!boundByHash && !boundByText) {
    throw new HttpError(502, 'LN_DESCRIPTION_MISMATCH', 'The invoice does not match the address')
  }
  const timestamp = Number(get('timestamp'))
  const expiry = Number(get('expiry') ?? expirySeconds ?? 3600)
  const expiresAt = timestamp + expiry
  if (!Number.isFinite(expiresAt) || expiresAt - expected.nowSeconds < MIN_INVOICE_LIFETIME_S) {
    throw new HttpError(502, 'LN_EXPIRED', 'The invoice has expired or is about to')
  }
  const paymentHash = get('payment_hash')
  if (typeof paymentHash !== 'string' || !/^[0-9a-f]{64}$/i.test(paymentHash)) {
    throw new HttpError(502, 'LN_BAD_INVOICE', 'The invoice has no payment hash')
  }
  return { paymentHash: paymentHash.toLowerCase(), amountMsat: expected.amountMsat, expiresAt }
}

export const verifyResponseSchema = z
  .object({
    status: z.literal('OK').optional(),
    settled: z.boolean(),
    preimage: z.string().nullable().optional(),
  })
  .passthrough()

/** LUD-21: GET the verify URL; `settled: true` means the Lightning payment arrived. */
export async function checkVerifyUrl(fetchImpl: FetchLike, verifyUrl: string): Promise<boolean> {
  const raw = await fetchLnurlJson(fetchImpl, verifyUrl)
  const parsed = verifyResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(502, 'LNURL_BAD_RESPONSE', 'The payment status reply was unreadable')
  }
  return parsed.data.settled
}

/** Pulls human-readable bits out of LUD-06 metadata ([["text/plain", "..."], ...]) for logs. */
export function summarizeMetadata(metadata: string): Record<string, string> {
  try {
    const entries = JSON.parse(metadata) as unknown
    if (!Array.isArray(entries)) return {}
    const out: Record<string, string> = {}
    for (const entry of entries) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        out[entry[0]] = entry[0].startsWith('image/') ? `[${entry[1].length} chars]` : entry[1]
      }
    }
    return out
  } catch {
    return {}
  }
}

/** The `text/identifier` entry of LNURL metadata: the address an invoice should pay. */
function metadataIdentifier(metadata: string): string | null {
  try {
    const entries = JSON.parse(metadata) as unknown
    if (!Array.isArray(entries)) return null
    const found = entries.find(
      (e): e is [string, string] =>
        Array.isArray(e) && e[0] === 'text/identifier' && typeof e[1] === 'string',
    )
    return found ? found[1] : null
  } catch {
    return null
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
