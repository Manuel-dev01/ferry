import { USDT0_ADDRESS } from './constants'

// USDT0 on Polygon supports Polygon PoS native meta-transactions (executeMetaTransaction).
// Its EIP-712 domain is the "salted" layout: no chainId field; the salt is bytes32(137).
export const USDT0_DOMAIN = {
  name: 'USDT0',
  version: '1',
  verifyingContract: USDT0_ADDRESS,
  salt: '0x0000000000000000000000000000000000000000000000000000000000000089',
} as const

export const USDT0_DOMAIN_SEPARATOR =
  '0x7b43b7deae87806d0ace67d6c8e9e347fc85db8ad198e756e5c17d126fef9a05' as const

export const META_TX_TYPES = {
  MetaTransaction: [
    { name: 'nonce', type: 'uint256' },
    { name: 'from', type: 'address' },
    { name: 'functionSignature', type: 'bytes' },
  ],
} as const

export const EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
] as const

export interface MetaTxMessage {
  nonce: string
  from: `0x${string}`
  functionSignature: `0x${string}`
}

/** The JSON payload a wallet expects for eth_signTypedData_v4 (EIP712Domain must be explicit). */
export function buildMetaTxTypedData(message: MetaTxMessage) {
  return {
    types: { EIP712Domain: EIP712_DOMAIN_TYPE, ...META_TX_TYPES },
    primaryType: 'MetaTransaction' as const,
    domain: USDT0_DOMAIN,
    message,
  }
}
