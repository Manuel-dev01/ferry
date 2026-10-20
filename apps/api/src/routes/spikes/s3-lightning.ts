import {
  spikeLnOutcomeRequestSchema,
  spikeLnurlRequestSchema,
  type SpikeLnurlResponse,
} from '@ferry/shared'
import { Hono } from 'hono'
import type { AppEnv, Deps } from '../../app'
import { HttpError } from '../../errors'
import {
  checkVerifyUrl,
  requestInvoice,
  resolveLightningAddress,
  summarizeMetadata,
  validateInvoice,
} from '../../lightning'
import { parseJson } from '../validate'

interface IssuedInvoice {
  verifyUrl: string | undefined
  expiresAt: number
}

const keysOf = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v) : [])

export function s3Routes(deps: Deps) {
  const r = new Hono<AppEnv>()
  const issued = new Map<string, IssuedInvoice>()

  // Resolve a Lightning address, fetch a fixed-amount invoice, and validate it before the
  // web app hands it to payLightningInvoice.
  r.post('/lnurl', async (c) => {
    const log = c.get('log').child({ spike: 's3' })
    const { address, sats } = await parseJson(c, spikeLnurlRequestSchema)
    if (sats > deps.env.SPIKE_LN_MAX_SATS) {
      throw new HttpError(
        400,
        'SPIKE_LIMIT',
        `Spike payments are capped at ${deps.env.SPIKE_LN_MAX_SATS} sats`,
      )
    }
    const domain = address.slice(address.lastIndexOf('@') + 1)

    const { payRequest, raw: payRaw } = await resolveLightningAddress(deps.fetch, address)
    // Spike learning log: everything about the pay request except the callback's query string.
    log.info(
      {
        domain,
        fields: keysOf(payRaw),
        minSendableMsat: payRequest.minSendable,
        maxSendableMsat: payRequest.maxSendable,
        commentAllowed: payRequest.commentAllowed,
        metadata: summarizeMetadata(payRequest.metadata),
        callbackHost: new URL(payRequest.callback).host,
        extras: Object.fromEntries(
          Object.entries(payRaw as Record<string, unknown>).filter(
            ([k]) => !['callback', 'metadata', 'minSendable', 'maxSendable', 'tag'].includes(k),
          ),
        ),
      },
      'lnurl pay request',
    )

    const amountMsat = BigInt(sats) * 1000n
    const { invoice, raw: invoiceRaw } = await requestInvoice(deps.fetch, payRequest, amountMsat)
    log.info(
      {
        domain,
        fields: keysOf(invoiceRaw),
        hasVerify: Boolean(invoice.verify),
        successAction: invoice.successAction ?? null,
      },
      'lnurl invoice response',
    )

    const validated = validateInvoice(invoice.pr, {
      amountMsat,
      metadata: payRequest.metadata,
      nowSeconds: Math.floor(Date.now() / 1000),
    })
    issued.set(validated.paymentHash, { verifyUrl: invoice.verify, expiresAt: validated.expiresAt })

    const body: SpikeLnurlResponse = {
      invoice: invoice.pr,
      paymentHash: validated.paymentHash,
      amountMsat: amountMsat.toString(),
      expiresAt: validated.expiresAt,
      hasVerify: Boolean(invoice.verify),
      limits: {
        minSendableMsat: String(payRequest.minSendable),
        maxSendableMsat: String(payRequest.maxSendable),
      },
    }
    return c.json(body)
  })

  // LUD-21 status. Only URLs we received from the Lightning service are ever fetched.
  r.get('/ln-verify/:paymentHash', async (c) => {
    const entry = issued.get(c.req.param('paymentHash').toLowerCase())
    if (!entry) throw new HttpError(404, 'LN_UNKNOWN_INVOICE', 'This invoice was not issued here')
    if (!entry.verifyUrl) throw new HttpError(404, 'LN_NO_VERIFY', 'This service has no status URL')
    const settled = await checkVerifyUrl(deps.fetch, entry.verifyUrl)
    return c.json({ settled, checkedAt: Math.floor(Date.now() / 1000) })
  })

  // Records what payLightningInvoice returned, so we learn the host's behaviour.
  r.post('/ln-outcome', async (c) => {
    const body = await parseJson(c, spikeLnOutcomeRequestSchema)
    c.get('log').info({ spike: 's3', ...body }, 'payLightningInvoice outcome')
    return c.json({ ok: true })
  })

  return r
}
