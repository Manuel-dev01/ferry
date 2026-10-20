import { describe, expect, it } from 'vitest'
import { validateInvoice } from '../src/lightning'

// A real 2,000-sat mainnet invoice (public test vector from light-bolt11-decoder). It carries a
// plain description rather than an LNURL description hash, and expired long ago.
const INVOICE =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'

describe('validateInvoice with the real decoder', () => {
  const base = { metadata: '[]', nowSeconds: 0 }

  it('reads the amount in millisatoshis', () => {
    expect(() => validateInvoice(INVOICE, { ...base, amountMsat: 1_000_000n })).toThrow(
      expect.objectContaining({ code: 'LN_AMOUNT_MISMATCH' }),
    )
  })

  it('requires an LNURL description hash once the amount matches', () => {
    expect(() => validateInvoice(INVOICE, { ...base, amountMsat: 2_000_000n })).toThrow(
      expect.objectContaining({ code: 'LN_DESCRIPTION_MISMATCH' }),
    )
  })

  it('rejects garbage', () => {
    expect(() => validateInvoice('lnbc1notaninvoice', { ...base, amountMsat: 1n })).toThrow(
      expect.objectContaining({ code: 'LN_BAD_INVOICE' }),
    )
  })
})
