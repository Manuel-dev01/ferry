import { describe, expect, it } from 'vitest'
import { nimSwapStage } from '../src/lib/nimSwap'

describe('NIM swap state interpretation', () => {
  it.each([
    'pending',
    'clientfundingseen',
    'clientfunded',
    'serverfunded',
    'clientredeeming',
    'clientredeemed',
    'serverredeemed',
  ])('recognizes %s', (status) => {
    expect(nimSwapStage(status)).not.toBe('failed')
    expect(nimSwapStage(status)).not.toBe('checking')
  })
  it.each([
    'clientrefunded',
    'clientfundedserverrefunded',
    'clientrefundedserverfunded',
    'clientrefundedserverrefunded',
    'expired',
    'clientinvalidfunded',
    'clientfundedtoolate',
    'serverwontfund',
  ])('recognizes terminal failure %s', (status) => expect(nimSwapStage(status)).toBe('failed'))
  it.each(['new-provider-status', '', 'clientredeemedandclientrefunded'])(
    'does not invent a failure for %s',
    (status) => expect(nimSwapStage(status)).toBe('checking'),
  )
})
