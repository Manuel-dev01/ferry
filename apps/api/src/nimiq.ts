import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const NIMIQ_BASE32 = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
const COUNTRY_CODE = 'NQ'
const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

function toNimiqBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += NIMIQ_BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += NIMIQ_BASE32[(value << (5 - bits)) & 31]
  return out
}

function ibanMod97(str: string): number {
  const digits = Array.from(str.toUpperCase(), (c) => {
    const code = c.charCodeAt(0)
    return code >= 48 && code <= 57 ? c : String(code - 55)
  }).join('')
  let rem = 0
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97
  return rem
}

/** 20 address bytes → "NQ07 0000 …" (IBAN-style check digits over Nimiq base32). */
export function toUserFriendlyAddress(addressBytes: Uint8Array): string {
  if (addressBytes.length !== 20) throw new Error('A Nimiq address is 20 bytes')
  const base32 = toNimiqBase32(addressBytes)
  const check = String(98 - ibanMod97(`${base32}${COUNTRY_CODE}00`)).padStart(2, '0')
  return `${COUNTRY_CODE}${check}${base32}`.replace(/.{4}/g, '$& ').trim()
}

/** A Nimiq address is the first 20 bytes of BLAKE2b-256(publicKey). */
export function addressFromPublicKey(publicKey: Uint8Array): string {
  return toUserFriendlyAddress(blake2b(publicKey, { dkLen: 32 }).slice(0, 20))
}

export function normalizeNimiqAddress(address: string): string {
  return address.replace(/\s/g, '').toUpperCase()
}

export type SignScheme = 'raw' | 'prefixed'

/** The byte strings a Nimiq wallet might have signed for `message`, in the order we try them. */
export function signedMessageCandidates(message: string): Record<SignScheme, Uint8Array> {
  const msg = utf8ToBytes(message)
  const prefixed = concatBytes(
    utf8ToBytes(SIGNED_MESSAGE_PREFIX),
    utf8ToBytes(String(msg.length)),
    msg,
  )
  return { raw: msg, prefixed: sha256(prefixed) }
}

/**
 * Verifies a Nimiq `sign()` result and derives the signer's address from the public key.
 * Returns which message format verified, so we learn the host's scheme.
 */
export function verifyNimiqSignature(
  message: string,
  publicKeyHex: string,
  signatureHex: string,
): { scheme: SignScheme; address: string } | null {
  let publicKey: Uint8Array
  let signature: Uint8Array
  try {
    publicKey = hexToBytes(publicKeyHex)
    signature = hexToBytes(signatureHex)
  } catch {
    return null
  }
  if (publicKey.length !== 32 || signature.length !== 64) return null
  for (const [scheme, bytes] of Object.entries(signedMessageCandidates(message))) {
    let ok: boolean
    try {
      ok = ed25519.verify(signature, bytes, publicKey)
    } catch {
      ok = false
    }
    if (ok) return { scheme: scheme as SignScheme, address: addressFromPublicKey(publicKey) }
  }
  return null
}
