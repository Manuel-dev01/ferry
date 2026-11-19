import { NimiqProviderError } from '@nimiq/mini-app-sdk'
import { describe, expect, it } from 'vitest'
import { lightningFailure } from '../src/lib/lightningFailure'

const error = (type: string, message: string, data?: unknown) =>
  new NimiqProviderError(type, message, undefined, data)

describe('Lightning payment failures', () => {
  it("keeps Nimiq Pay's own reason for the screen, on one short line", () => {
    const said = lightningFailure(
      error('INVALID_REQUEST', `Cannot create swap:\n  ${'x'.repeat(300)}`),
      10000,
      4600,
    ).said
    expect(said.startsWith('INVALID_REQUEST · Cannot create swap: x')).toBe(true)
    expect(said).not.toContain('\n')
    expect(said.length).toBeLessThanOrEqual(180)
  })
  it('tells a swap-service outage apart from a bad payment', () => {
    expect(
      lightningFailure(error('INVALID_TRANSACTION', 'Cannot create swap'), 10000, 4600).kind,
    ).toBe('swapDown')
    // a known payment id still means it may have gone out
    expect(
      lightningFailure(
        error('INVALID_TRANSACTION', 'Cannot create swap', { hash: 'h' }),
        10000,
        4600,
      ).kind,
    ).toBe('uncertain')
  })
  it('keeps a valid invoice after the Samsung balance rejection', () => {
    expect(
      lightningFailure(error('INVALID_TRANSACTION', 'Insufficient NIM balance'), 10000, 4600).kind,
    ).toBe('insufficient')
  })
  it('does not turn a generic validation failure into an expired quote', () => {
    expect(lightningFailure(error('INVALID_REQUEST', 'Cannot start swap'), 10000, 4600).kind).toBe(
      'invalid',
    )
  })
  it('only uses expiry once the known invoice deadline has passed', () => {
    expect(lightningFailure(error('INVALID_TRANSACTION', 'Invalid invoice'), 4600, 4600).kind).toBe(
      'expired',
    )
    expect(lightningFailure(error('INVALID_TRANSACTION', 'Invalid invoice'), 0, 4600).kind).toBe(
      'invalid',
    )
  })
  it.each(['DUPLICATE_PAYMENT', 'TRANSACTION_OUTCOME_UNKNOWN', 'NETWORK_ERROR', 'INTERNAL_ERROR'])(
    'keeps %s ambiguous even with a balance-like message or expired invoice',
    (type) => {
      expect(lightningFailure(error(type, 'Insufficient NIM balance'), 100, 4600).kind).toBe(
        'uncertain',
      )
    },
  )
  it('reconciles any attached payment identifiers before another attempt', () => {
    const result = lightningFailure(
      error('INVALID_TRANSACTION', 'Insufficient NIM balance', { hash: 'known', swapId: 'swap' }),
      10000,
      4600,
    )
    expect(result).toMatchObject({ kind: 'uncertain', ids: { hash: 'known', swapId: 'swap' } })
  })
  it('does not treat an untyped exception or liquidity shortage as proof of insufficient wallet funds', () => {
    expect(lightningFailure(new Error('Insufficient NIM balance'), 10000, 4600).kind).toBe(
      'uncertain',
    )
    expect(
      lightningFailure(error('INVALID_TRANSACTION', 'Not enough liquidity'), 10000, 4600).kind,
    ).toBe('invalid')
  })
})
