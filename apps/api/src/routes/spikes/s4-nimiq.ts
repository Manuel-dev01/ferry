import { spikeNimVerifyRequestSchema, type SpikeNimVerifyResponse } from '@ferry/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../../app'
import { HttpError } from '../../errors'
import { verifyNimiqSignature } from '../../nimiq'
import { parseJson } from '../validate'

const CHALLENGE_TTL_MS = 5 * 60_000

export function s4Routes() {
  const r = new Hono<AppEnv>()
  const challenges = new Map<string, number>() // challenge → expiry (ms)

  r.get('/nim/challenge', (c) => {
    const now = Date.now()
    for (const [k, exp] of challenges) if (exp < now) challenges.delete(k)
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')
    const challenge = `Sign in to Ferry\nNonce: ${nonce}\nIssued: ${new Date(now).toISOString()}`
    challenges.set(challenge, now + CHALLENGE_TTL_MS)
    return c.json({ challenge })
  })

  r.post('/nim/verify', async (c) => {
    const { challenge, publicKey, signature } = await parseJson(c, spikeNimVerifyRequestSchema)
    const expiry = challenges.get(challenge)
    if (!expiry || expiry < Date.now()) {
      throw new HttpError(400, 'CHALLENGE_EXPIRED', 'That sign-in request expired; try again')
    }
    challenges.delete(challenge) // single use
    const result = verifyNimiqSignature(challenge, publicKey, signature)
    c.get('log').info({ spike: 's4', scheme: result?.scheme ?? null }, 'nimiq sign verification')
    const body: SpikeNimVerifyResponse = {
      valid: Boolean(result),
      scheme: result?.scheme ?? null,
      address: result?.address ?? null,
    }
    return c.json(body)
  })

  return r
}
