// Paycrest Gateway (on-chain order creation). The Gateway contract is permissionless: anyone
// holding a supported token can call createOrder. Recipient details travel encrypted for the
// aggregator, and payout progress is read back from the contract.
import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto'
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
  type Log,
} from 'viem'

/** Paycrest Gateway proxy on Polygon (paycrest/contracts README, verified on-chain 2026-10-26). */
export const POLYGON_GATEWAY: Address = '0xfB411Cc6385Af50A562aFCb441864E9d541CDA67'

export const gatewayAbi = parseAbi([
  'function createOrder(address _token, uint256 _amount, uint96 _rate, address _senderFeeRecipient, uint256 _senderFee, address _refundAddress, string messageHash) returns (bytes32 orderId)',
  'function getOrderInfo(bytes32 _orderId) view returns ((address sender, address token, address senderFeeRecipient, uint256 senderFee, uint256 protocolFee, bool isFulfilled, bool isRefunded, address refundAddress, uint96 currentBPS, uint256 amount))',
  'function isTokenSupported(address _token) view returns (bool)',
  'event OrderCreated(address indexed sender, address indexed token, uint256 indexed amount, uint256 protocolFee, bytes32 orderId, uint256 rate, string messageHash)',
])

/** Recipient fields the aggregator decrypts. Names and order follow its payload struct. */
export interface RecipientPayload {
  Nonce: string
  AccountIdentifier: string
  AccountName: string
  Institution: string
  ProviderID: string
  Memo: string
  Metadata: Record<string, unknown> | null
}

export function buildRecipient(input: {
  institution: string
  accountIdentifier: string
  accountName: string
  memo: string
}): RecipientPayload {
  return {
    Nonce: randomBytes(12).toString('base64'),
    AccountIdentifier: input.accountIdentifier,
    AccountName: input.accountName,
    Institution: input.institution,
    ProviderID: '',
    Memo: input.memo,
    Metadata: null,
  }
}

/**
 * Hybrid envelope: AES-256-GCM over the JSON, with the AES key wrapped by the aggregator's
 * RSA key (PKCS#1 v1.5). Layout: [u32 BE key length][wrapped key][12-byte nonce][ciphertext]
 * [16-byte tag], base64-encoded. The aggregator rejects payloads over 500 bytes of JSON.
 */
export function encryptRecipient(payload: RecipientPayload, publicKeyPem: string): string {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  if (plaintext.length > 500) throw new Error('Recipient details are too long')
  const key = randomBytes(32)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const wrapped = publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, key)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(wrapped.length, 0)
  return Buffer.concat([len, wrapped, nonce, ciphertext, tag]).toString('base64')
}

/** The Gateway stores rates as rate × 100, rounded to the nearest integer. Exact decimal math. */
export function scaleRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim())
  if (!m) throw new Error(`Invalid rate "${rate}"`)
  const frac = (m[2] ?? '').padEnd(3, '0')
  const hundredths = BigInt(m[1]!) * 100n + BigInt(frac.slice(0, 2))
  const third = Number(frac[2])
  const rest = frac.slice(3).replace(/0/g, '') !== ''
  // half-to-even on the third decimal
  const roundUp = third > 5 || (third === 5 && (rest || hundredths % 2n === 1n))
  return roundUp ? hundredths + 1n : hundredths
}

export interface GatewayOrderCall {
  approve: { to: Address; data: Hex }
  createOrder: { to: Address; data: Hex }
}

export function buildGatewayCalls(input: {
  gateway: Address
  token: Address
  amount: bigint
  rate: bigint
  senderFeeRecipient: Address
  senderFee: bigint
  refundAddress: Address
  messageHash: string
}): GatewayOrderCall {
  return {
    approve: {
      to: input.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [input.gateway, input.amount + input.senderFee],
      }),
    },
    createOrder: {
      to: input.gateway,
      data: encodeFunctionData({
        abi: gatewayAbi,
        functionName: 'createOrder',
        args: [
          input.token,
          input.amount,
          input.rate,
          input.senderFeeRecipient,
          input.senderFee,
          input.refundAddress,
          input.messageHash,
        ],
      }),
    },
  }
}

/** Finds the Gateway order id in a createOrder receipt. */
export function orderIdFromLogs(logs: Log[], gateway: Address): Hex | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== gateway.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: gatewayAbi, data: log.data, topics: log.topics })
      if (ev.eventName === 'OrderCreated') return ev.args.orderId
    } catch {
      // other Gateway events
    }
  }
  return null
}
