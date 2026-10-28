import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
  type Log,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  buildGatewayCalls,
  buildRecipient,
  encryptRecipient,
  gatewayAbi,
  gatewayGasNeedWei,
  orderIdFromLogs,
  POLYGON_GATEWAY,
  scaleRate,
} from '../src/gateway'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function decrypt(envelopeB64: string): unknown {
  const buf = Buffer.from(envelopeB64, 'base64')
  const keyLen = buf.readUInt32BE(0)
  const wrapped = buf.subarray(4, 4 + keyLen)
  const nonce = buf.subarray(4 + keyLen, 16 + keyLen)
  const body = buf.subarray(16 + keyLen)
  const ciphertext = body.subarray(0, body.length - 16)
  const tag = body.subarray(body.length - 16)
  const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, wrapped)
  const decipher = createDecipheriv('aes-256-gcm', aesKey, nonce)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}

describe('recipient encryption', () => {
  it('round-trips through the hybrid envelope with the aggregator field names', () => {
    const recipient = buildRecipient({
      institution: 'GTBINGLA',
      accountIdentifier: '0123456789',
      accountName: 'ADA OBI',
      memo: 'Ferry',
    })
    const out = decrypt(encryptRecipient(recipient, pem)) as Record<string, unknown>
    expect(out).toEqual(recipient)
    expect(Object.keys(out)).toEqual([
      'Nonce',
      'AccountIdentifier',
      'AccountName',
      'Institution',
      'ProviderID',
      'Memo',
      'Metadata',
    ])
  })

  it('uses a fresh key and nonce every time', () => {
    const r = buildRecipient({
      institution: 'X',
      accountIdentifier: '1',
      accountName: 'A',
      memo: '',
    })
    expect(encryptRecipient(r, pem)).not.toBe(encryptRecipient(r, pem))
  })

  it('refuses payloads the aggregator would reject', () => {
    const r = buildRecipient({
      institution: 'X',
      accountIdentifier: '1',
      accountName: 'A'.repeat(600),
      memo: '',
    })
    expect(() => encryptRecipient(r, pem)).toThrow(/too long/)
  })
})

describe('scaleRate', () => {
  it('stores rate × 100, rounded half to even', () => {
    expect(scaleRate('1353.05')).toBe(135305n)
    expect(scaleRate('1353')).toBe(135300n)
    expect(scaleRate('128.574')).toBe(12857n)
    expect(scaleRate('128.576')).toBe(12858n)
    expect(scaleRate('128.565')).toBe(12856n) // half to even: ..56 stays
    expect(scaleRate('128.575')).toBe(12858n) // half to even: ..57 rounds up to ..58
    expect(scaleRate('128.5651')).toBe(12857n)
    expect(() => scaleRate('abc')).toThrow()
  })
})

describe('gateway calls', () => {
  const user = '0x1111111111111111111111111111111111111111' as const
  const token = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as const

  it('approves exactly amount + fee and creates the order with refunds to the user', () => {
    const calls = buildGatewayCalls({
      gateway: POLYGON_GATEWAY,
      token,
      amount: 1_000_000n,
      rate: 135305n,
      senderFeeRecipient: '0x2222222222222222222222222222222222222222',
      senderFee: 5_000n,
      refundAddress: user,
      messageHash: 'abc',
    })
    expect(calls.approve.to).toBe(token)
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls.approve.data })
    expect(approve.args).toEqual([POLYGON_GATEWAY, 1_005_000n])
    expect(calls.createOrder.to).toBe(POLYGON_GATEWAY)
    const create = decodeFunctionData({ abi: gatewayAbi, data: calls.createOrder.data })
    expect(create.functionName).toBe('createOrder')
    expect(create.args).toEqual([
      token,
      1_000_000n,
      135305n,
      '0x2222222222222222222222222222222222222222',
      5_000n,
      user,
      'abc',
    ])
  })

  it('finds the order id in the receipt logs', () => {
    const orderId = `0x${'ab'.repeat(32)}` as Hex
    const topics = encodeEventTopics({
      abi: gatewayAbi,
      eventName: 'OrderCreated',
      args: { sender: user, token, amount: 1_000_000n },
    })
    const data = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'string' }],
      [0n, orderId, 135305n, 'abc'],
    )
    const log = { address: POLYGON_GATEWAY, topics, data } as unknown as Log
    expect(orderIdFromLogs([log], POLYGON_GATEWAY)).toBe(orderId)
    expect(orderIdFromLogs([{ ...log, address: token } as Log], POLYGON_GATEWAY)).toBeNull()
  })
})

describe('gatewayGasNeedWei', () => {
  // Seen live on 2026-10-28: Nimiq Pay asked for 426,193 gas at a 527.48 gwei max fee.
  const maxFee = 527_480_000_000n

  it('covers what Nimiq Pay budgets for createOrder alone', () => {
    expect(gatewayGasNeedWei(maxFee, false)).toBeGreaterThan(426_193n * maxFee)
  })

  it('adds the approval when one is still needed', () => {
    const both = gatewayGasNeedWei(maxFee, true)
    expect(both - gatewayGasNeedWei(maxFee, false)).toBe((80_000n * maxFee * 5n) / 4n)
  })
})
