import { ed25519 } from '@noble/curves/ed25519.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { signedMessageCandidates, toUserFriendlyAddress, verifyNimiqSignature } from '../src/nimiq'

describe('Nimiq addresses', () => {
  it('formats the all-zero address as the well-known burn address', () => {
    expect(toUserFriendlyAddress(new Uint8Array(20))).toBe(
      'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    )
  })

  it('rejects wrong lengths', () => {
    expect(() => toUserFriendlyAddress(new Uint8Array(19))).toThrow()
  })
})

describe('verifyNimiqSignature', () => {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const message = 'Sign in to Ferry\nNonce: abc'

  it('verifies a raw-message signature and derives an NQ address', () => {
    const sig = ed25519.sign(signedMessageCandidates(message).raw, secret)
    const result = verifyNimiqSignature(message, bytesToHex(publicKey), bytesToHex(sig))
    expect(result?.scheme).toBe('raw')
    expect(result?.address).toMatch(/^NQ\d{2}( [0-9A-HJ-NP-VXY]{4}){8}$/)
  })

  it('verifies a prefixed (Nimiq signed message) signature', () => {
    const sig = ed25519.sign(signedMessageCandidates(message).prefixed, secret)
    expect(verifyNimiqSignature(message, bytesToHex(publicKey), bytesToHex(sig))?.scheme).toBe(
      'prefixed',
    )
  })

  it('rejects tampered messages and malformed input', () => {
    const sig = bytesToHex(ed25519.sign(signedMessageCandidates(message).raw, secret))
    expect(verifyNimiqSignature(`${message}!`, bytesToHex(publicKey), sig)).toBeNull()
    expect(verifyNimiqSignature(message, 'zz', sig)).toBeNull()
    expect(verifyNimiqSignature(message, bytesToHex(publicKey), sig.slice(2))).toBeNull()
  })
})
