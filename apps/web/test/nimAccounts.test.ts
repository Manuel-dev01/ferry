import { describe, expect, it } from 'vitest'
import { fullestNimAddress, readNimBalances } from '../src/lib/nimAccounts'

const EMPTY = 'NQ84 EMPTY'
const FULL = 'NQ74 FULL'

describe('NIM address choice', () => {
  it('reads every address and leaves out the ones that fail', async () => {
    const balances = await readNimBalances([EMPTY, FULL, 'NQ00 BROKEN'], async (a) => {
      if (a === 'NQ00 BROKEN') throw new Error('network')
      return a === FULL ? 1_797_000_000 : 0
    })
    expect(balances).toEqual(
      new Map([
        [EMPTY, 0n],
        [FULL, 1_797_000_000n],
      ]),
    )
  })

  it('starts on the address holding the NIM, even when the wallet lists an empty one first', () => {
    const balances = new Map([
      [EMPTY, 0n],
      [FULL, 1_797_000_000n],
    ])
    expect(fullestNimAddress([EMPTY, FULL], balances, null)).toBe(FULL)
    expect(fullestNimAddress([EMPTY, FULL], balances, EMPTY)).toBe(FULL)
  })

  it('keeps the current address on a tie, then the wallet order', () => {
    const balances = new Map([
      [EMPTY, 0n],
      [FULL, 0n],
    ])
    expect(fullestNimAddress([EMPTY, FULL], balances, FULL)).toBe(FULL)
    expect(fullestNimAddress([EMPTY, FULL], balances, null)).toBe(EMPTY)
    expect(fullestNimAddress([EMPTY, FULL], balances, 'NQ99 GONE')).toBe(EMPTY)
  })

  it('gives no answer when nothing could be read', () => {
    expect(fullestNimAddress([EMPTY, FULL], new Map(), EMPTY)).toBeNull()
  })
})
