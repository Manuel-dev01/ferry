import { NimiqProviderError } from '@nimiq/mini-app-sdk'
import { describe, expect, it } from 'vitest'
import { lightningFailure } from '../src/lib/lightningFailure'

const error = (type: string, message: string, data?: unknown) =>
  new NimiqProviderError(type, message, undefined, data)

describe('Lightning payment failures', () => {
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
    expect(result).toEqual({ kind: 'uncertain', ids: { hash: 'known', swapId: 'swap' } })
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
