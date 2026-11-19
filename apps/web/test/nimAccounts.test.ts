import { describe, expect, it } from 'vitest'
import { readNimBalances } from '../src/lib/nimAccounts'

describe('NIM address balances', () => {
  it('reads every address and leaves out the ones that fail', async () => {
    const balances = await readNimBalances(
      ['NQ84 WALLET', 'NQ74 HTLC', 'NQ00 BROKEN'],
      async (a) => {
        if (a === 'NQ00 BROKEN') throw new Error('network')
        return a === 'NQ74 HTLC' ? 1_797_000_000 : 0
      },
    )
    expect(balances).toEqual(
      new Map([
        ['NQ84 WALLET', 0n],
        ['NQ74 HTLC', 1_797_000_000n],
      ]),
    )
  })
})
