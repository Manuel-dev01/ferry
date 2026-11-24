import { formatNim, formatUsdt, parseUnits } from '@ferry/shared'
import { DirectQuoteError, verifyDirectNimQuote } from './nim-direct-quote'

// Explicit operator tool, not an HTTP payment endpoint. Reads quotes; never creates an order.
try {
  const raw = process.argv[2]
  if (!raw) throw new DirectQuoteError('USAGE: pnpm --filter api check:nim-direct <NIM amount>')
  let luna: bigint
  try {
    luna = parseUnits(raw, 5)
  } catch {
    throw new DirectQuoteError('INVALID_NIM_AMOUNT')
  }
  const quote = await verifyDirectNimQuote(process.env.CHANGEHERO_API_KEY, luna)
  process.stdout.write(
    JSON.stringify(
      {
        provider: 'changehero',
        estimateOnly: true,
        amountNim: formatNim(luna),
        pair: quote.pair,
        minimumNim: formatNim(quote.minimumLuna),
        available: quote.available,
        ...(quote.available ? { estimatedUsdt: formatUsdt(quote.estimatedUsdtUnits) } : {}),
        note: 'Read-only quote; no order, deposit address or payment created. Not enabled in Ferry.',
      },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  // Never print an upstream body, arbitrary exception, credential, wallet or request headers.
  console.error(error instanceof DirectQuoteError ? error.code : 'QUOTE_CHECK_FAILED')
  process.exitCode = 1
}
