import { NimiqProviderError } from '@nimiq/mini-app-sdk'
import { describe, expect, it } from 'vitest'
import { classifyEvmError, evmErrorText, EvmUnavailableError } from '../src/providers/evm'
import { classifyNimiqError, lightningIdsFrom } from '../src/providers/nimiq'

const providerError = (type: string, data?: unknown) =>
  new NimiqProviderError(type, type, undefined, data)

describe('classifyNimiqError', () => {
  it.each([
    ['PERMISSION_DENIED', 'rejected'],
    ['UNKNOWN_REQUEST', 'unsupported'],
    ['INVALID_REQUEST', 'invalid'],
    ['INVALID_TRANSACTION', 'invalid'],
    ['NETWORK_ERROR', 'network'],
    ['DUPLICATE_PAYMENT', 'duplicate'],
    ['TRANSACTION_OUTCOME_UNKNOWN', 'outcome_unknown'],
    ['INTERNAL_ERROR', 'wallet'],
    ['SOMETHING_NEW', 'unknown'],
  ])('%s → %s', (type, kind) => {
    expect(classifyNimiqError(providerError(type)).kind).toBe(kind)
  })

  it('treats non-provider errors as unknown', () => {
    expect(classifyNimiqError(new Error('x')).kind).toBe('unknown')
  })

  it('extracts Lightning ids from error data', () => {
    expect(lightningIdsFrom({ hash: 'h', swapId: 's', other: 1 })).toEqual({
      hash: 'h',
      swapId: 's',
    })
    expect(lightningIdsFrom(null)).toEqual({})
  })
})

describe('classifyEvmError', () => {
  it('maps EIP-1193 codes', () => {
    expect(classifyEvmError({ code: 4001 })).toBe('rejected')
    expect(classifyEvmError({ code: 4902 })).toBe('chain_missing')
    expect(classifyEvmError({ code: 4200 })).toBe('unsupported')
    expect(classifyEvmError({ code: -32603 })).toBe('unknown')
    expect(classifyEvmError(new EvmUnavailableError('x'))).toBe('unavailable')
  })
})

it('does not claim an unknown wallet failure left funds untouched', () => {
  expect(evmErrorText(undefined)).not.toContain('Nothing was sent')
  expect(evmErrorText(undefined)).toContain('Check its activity')
})
