import { USDT0_ADDRESS } from '@ferry/shared'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Log } from 'viem'
import { describe, expect, it } from 'vitest'
import { computeStats } from '../src/proof'
import { swapPayout } from '../src/routes/swaps'
import { makeApp } from './helpers'

const USER: Address = '0x358bC84A34Df878A5497DFc01D14D6AaFe7E8A76'
const OTHER: Address = '0x1111111254EEB25477B68fb85Ed929f73A960582'
const HTLC: Address = '0xfB411Cc6385Af50A562aFCb441864E9d541CDA67'
const COORDINATOR: Address = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'
const RELAY: Address = '0xd703aaE79538628d27099B8c4f621bE4CCd142d5'

const swap = {
  evm_htlc_address: HTLC,
  evm_coordinator_address: COORDINATOR,
  target_evm_address: USER,
}

function transferLog(from: Address, to: Address, value: bigint, token: Address = USDT0_ADDRESS) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  } as unknown as Log
}
const eventFrom = (address: Address) => ({ address, topics: [], data: '0x' }) as unknown as Log

describe('swapPayout', () => {
  it('reads the USDT a claim paid to the swap’s target', () => {
    const receipt = {
      status: 'success' as const,
      to: COORDINATOR,
      logs: [transferLog(COORDINATOR, USER, 5_000_000n)],
    }
    expect(swapPayout(swap, receipt)).toEqual({ to: USER, units: 5_000_000n })
  })

  it('accepts a gasless claim sent through a relayer when the swap’s contract shows in the logs', () => {
    const receipt = {
      status: 'success' as const,
      to: RELAY,
      logs: [eventFrom(HTLC), transferLog(COORDINATOR, USER, 2_000_000n)],
    }
    expect(swapPayout(swap, receipt)).toEqual({ to: USER, units: 2_000_000n })
  })

  it('rejects a transaction that never touched the swap’s contracts', () => {
    const receipt = {
      status: 'success' as const,
      to: RELAY,
      logs: [transferLog(RELAY, USER, 5_000_000n)],
    }
    expect(swapPayout(swap, receipt)).toBeNull()
  })

  it('rejects USDT paid to someone other than the swap’s target, and other tokens', () => {
    const toOther = { status: 'success' as const, to: HTLC, logs: [transferLog(HTLC, OTHER, 1n)] }
    expect(swapPayout(swap, toOther)).toBeNull()
    const notUsdt = {
      status: 'success' as const,
      to: HTLC,
      logs: [transferLog(HTLC, USER, 1n, OTHER)],
    }
    expect(swapPayout(swap, notUsdt)).toBeNull()
  })

  it('rejects a reverted claim', () => {
    const receipt = { status: 'reverted' as const, to: HTLC, logs: [transferLog(HTLC, USER, 1n)] }
    expect(swapPayout(swap, receipt)).toBeNull()
  })
})

describe('NIM swaps on Proof of Ferry', () => {
  it('counts swaps and their USDT, leaving out excluded wallets', () => {
    const s = computeStats(
      [],
      [OTHER],
      Date.now(),
      [],
      [
        { toAddress: USER, amountUnits: 5_000_000n },
        { toAddress: USER, amountUnits: 2_500_000n },
        { toAddress: OTHER, amountUnits: 9_000_000n },
      ],
    )
    expect(s.nimSwaps).toEqual({ count: 2, volumeUnits: '7500000' })
    expect(s.cashouts).toBe(0) // a swap isn't a cash-out on its own
  })

  it('needs a database to record a swap', async () => {
    const res = await makeApp().request('/v1/nim-swaps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ swapId: 'b2f6c1d0-1234-4cde-9abc-0123456789ab' }),
    })
    expect(res.status).toBe(503)
  })
})
