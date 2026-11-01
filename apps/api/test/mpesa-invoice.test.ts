import { describe, expect, it } from 'vitest'
import { validateInvoice } from '../src/lightning'

// A real invoice from Tando's M-Pesa Lightning address for an unassigned number (never paid).
// It carries a plain description naming the address instead of the LUD-06 description hash.
const INVOICE =
  'lnbc1920n1p4ww0hnpp59t74qxg94jqsk4g4q87gmrzh5ykdcq3kuvr3sals2h493ngleh6qcqzyssp5lh56pla8adz8grryaxysuejn35ngz80n8uchr8ftxe8w5nnvyr0q9q7sqqqqqqqqqqqqqqqqqqqsqqqqqysgqdpu2pshjmt9de6zqar0yqer2dphxqcrqvpsxqcrqsrzd96xxmmfdchxxmewddjsmqz9gxqzrcrzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glcllcmepmq3fthuvqqqqlgqqqqqeqqjqhqu642pnlsea6xzw7vt7k82uf6myhu9rw0kd9gkaelnne23tu838wr9t7yzr0uax6vm87h3qq7lq8084nuh2vpt8paqmvamk86xd5fqqjdvteg'
const METADATA =
  '[["text/plain","Payment to Kenyan phone 254700000000@bitcoin.co.ke"],["text/identifier","254700000000@bitcoin.co.ke"]]'
const base = { amountMsat: 192_000n, metadata: METADATA, nowSeconds: 1793539827 }

describe('validateInvoice with a plain-description invoice', () => {
  it('accepts it when the description names the address we resolved', () => {
    expect(validateInvoice(INVOICE, base).amountMsat).toBe(192_000n)
  })

  it('rejects it for a different address', () => {
    const other = METADATA.replaceAll('254700000000', '254711111111')
    expect(() => validateInvoice(INVOICE, { ...base, metadata: other })).toThrow(
      'does not match the address',
    )
  })
})
