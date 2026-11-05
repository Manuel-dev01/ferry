import { describe, expect, it, vi } from 'vitest'
import {
  entryAmount,
  entryAmountMuted,
  parseHistory,
  type HistoryEntry,
} from '../src/stores/history'

vi.mock('../src/lib/ferryApi', () => ({ ferryApi: {} }))

const valid: HistoryEntry = {
  id: 'receipt',
  clientSecret: '',
  createdAt: 1700000000000,
  currency: 'NGN',
  institutionName: 'Fonbnk',
  recipientMasked: '',
  recipientName: null,
  theyReceiveMinor: '0',
  status: 'handed_off',
  mock: false,
  provider: 'fonbnk',
  amountUnits: '4000000',
  txHash: `0x${'a'.repeat(64)}`,
}
describe('device history recovery', () => {
  it.each(['failed', 'expired', 'awaiting', 'swapping'])(
    'never labels %s incoming funds as received',
    (status) => {
      const entry: HistoryEntry = { ...valid, kind: 'nim', status, amountUnits: '1000000' }
      expect(entryAmount(entry)).toBe('1.00 USDT')
      expect(entryAmountMuted(entry)).toBe(true)
    },
  )
  it('only adds the incoming plus sign after receipt', () => {
    const entry: HistoryEntry = {
      ...valid,
      kind: 'topup',
      status: 'received',
      amountUnits: '1000000',
    }
    expect(entryAmount(entry)).toBe('+1.00 USDT')
    expect(entryAmountMuted(entry)).toBe(false)
  })
  it('keeps a valid receipt alongside interrupted or damaged entries', () => {
    const entries = parseHistory(JSON.stringify([null, {}, { id: 'broken' }, valid]))
    expect(entries).toEqual([valid])
    expect(entryAmount(entries[0]!)).toBe('4.00 USDT')
  })
  it.each([
    { amountUnits: 'not-units' },
    { theyReceiveMinor: '-1' },
    { createdAt: 'yesterday' },
    { createdAt: 9000000000000000 },
    { currency: '' },
    { currency: 'INVALID' },
    { payee: {} },
    { provider: 'unknown' },
    { kind: 'unknown' },
  ])('ignores unusable entry fields %j', (patch) => {
    expect(parseHistory(JSON.stringify([{ ...valid, ...patch }]))).toEqual([])
  })
  it.each([null, '{broken', '{}', 'null'])('recovers from %s', (raw) => {
    expect(parseHistory(raw)).toEqual([])
  })
  it('caps loaded history and preserves integer base units', () => {
    expect(
      parseHistory(
        JSON.stringify(Array.from({ length: 75 }, (_, i) => ({ ...valid, id: String(i) }))),
      ),
    ).toHaveLength(50)
    expect(
      parseHistory(JSON.stringify([{ ...valid, amountUnits: '9007199254740993' }]))[0]?.amountUnits,
    ).toBe('9007199254740993')
  })
})
