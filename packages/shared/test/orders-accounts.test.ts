import { describe, expect, it } from 'vitest'
import {
  accountKind,
  maskAccount,
  maskName,
  monogram,
  normalizeAccountIdentifier,
  normalizePhone,
} from '../src/accounts'
import { canTransition, isTerminal, trackerStepFor } from '../src/orders'

describe('order transitions', () => {
  it('only moves forward', () => {
    expect(canTransition('created', 'signed')).toBe(true)
    expect(canTransition('submitted', 'deposited')).toBe(true)
    expect(canTransition('pending', 'deposited')).toBe(false)
    expect(canTransition('pending', 'pending')).toBe(false)
  })

  it('treats terminal states as final', () => {
    expect(isTerminal('settled')).toBe(true)
    expect(canTransition('settled', 'refunded')).toBe(false)
    expect(canTransition('expired', 'submitted')).toBe(false)
  })

  it('lets a compliance hold return to pending', () => {
    expect(canTransition('compliance_hold', 'pending')).toBe(true)
    expect(canTransition('compliance_hold', 'settled')).toBe(true)
  })

  it('maps statuses to tracker steps', () => {
    expect(trackerStepFor('created')).toBeNull()
    expect(trackerStepFor('submitted')).toBe('sent')
    expect(trackerStepFor('deposited')).toBe('received')
    expect(trackerStepFor('compliance_hold')).toBe('paying')
    expect(trackerStepFor('settled')).toBe('paid')
  })
})

describe('account identifiers', () => {
  it('picks the right kind per corridor', () => {
    expect(accountKind('NGN', 'bank')).toBe('nuban')
    expect(accountKind('KES', 'mobile_money')).toBe('phone')
    expect(accountKind('TZS', 'bank')).toBe('account')
  })

  it('normalizes phones for KE, UG and TZ', () => {
    expect(normalizePhone('KES', '0712 345 678')).toBe('254712345678')
    expect(normalizePhone('UGX', '+256 772 123456')).toBe('256772123456')
    expect(normalizePhone('TZS', '0654321987')).toBe('255654321987')
    expect(normalizePhone('UGX', '0612345678')).toBeNull()
  })

  it('validates identifiers', () => {
    expect(normalizeAccountIdentifier('NGN', 'bank', '012 345 6789')).toBe('0123456789')
    expect(normalizeAccountIdentifier('NGN', 'bank', '12345')).toBeNull()
    expect(normalizeAccountIdentifier('KES', 'bank', '1234-5678-90')).toBe('1234567890')
  })

  it('masks for display and storage', () => {
    expect(maskAccount('0123456789')).toBe('••••6789')
    expect(maskName('Ada  Obi')).toBe('A** O**')
    expect(monogram('Guaranty Trust Bank')).toBe('GT')
    expect(monogram('OPay')).toBe('OP')
    expect(monogram('Bank of Africa')).toBe('AF')
  })
})
