import { POLYGON_CHAIN_ID_HEX } from '@ferry/shared'
import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export class EvmUnavailableError extends Error {
  override name = 'EvmUnavailableError'
}

function provider(): EIP1193Provider {
  if (!window.ethereum) throw new EvmUnavailableError('No Ethereum provider')
  return window.ethereum
}

export const hasEvmProvider = (): boolean => typeof window !== 'undefined' && !!window.ethereum

/** Approval: asks the user to share their EVM address. */
export async function requestAccount(): Promise<Address> {
  const accounts = await provider().request({ method: 'eth_requestAccounts' })
  const first = accounts[0]
  if (!first) throw new Error('No account returned')
  return getAddress(first)
}

/** No approval: the account the user already shared with Ferry, if any. Never prompts. */
export async function currentAccount(): Promise<Address | null> {
  const accounts = await provider().request({ method: 'eth_accounts' })
  return accounts[0] ? getAddress(accounts[0]) : null
}

/** No approval. */
export async function currentChainId(): Promise<Hex> {
  return provider().request({ method: 'eth_chainId' })
}

/** Approval: switches the wallet to Polygon, adding it first if the wallet doesn't know it. */
export async function switchToPolygon(): Promise<void> {
  try {
    await provider().request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: POLYGON_CHAIN_ID_HEX }],
    })
  } catch (err) {
    if (evmErrorCode(err) !== 4902) throw err
    await provider().request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: POLYGON_CHAIN_ID_HEX,
          chainName: 'Polygon',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
          blockExplorerUrls: ['https://polygonscan.com'],
        },
      ],
    })
  }
}

/** Approval: EIP-712 structured signature. The payload must include EIP712Domain. */
export async function signTypedDataV4(address: Address, typedData: unknown): Promise<Hex> {
  return provider().request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
  })
}

/**
 * Approval: a plain-text signature another site asks for over WalletConnect (a sign-in). Only
 * relayed as asked; Ferry's own structured signatures always use signTypedDataV4.
 */
export async function personalSign(address: Address, message: Hex): Promise<Hex> {
  return provider().request({ method: 'personal_sign', params: [message, address] })
}

/** Approval: a normal transaction the user pays gas for. `gas` skips the wallet's own estimate. */
export async function sendTransaction(tx: {
  from: Address
  to: Address
  data: Hex
  gas?: Hex
}): Promise<Hex> {
  return provider().request({ method: 'eth_sendTransaction', params: [tx] })
}

export function evmErrorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'number') {
    return err.code
  }
  return undefined
}

/** A readable line from whatever a wallet throws: an Error, an EIP-1193 error object or a string. */
export function evmErrorText(err: unknown): string {
  if (typeof err === 'string' && err) return err
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; reason?: unknown; code?: unknown }
    const msg = [e.message, e.reason].find((m): m is string => typeof m === 'string' && !!m)
    if (msg) {
      if (/insufficient funds/i.test(msg)) {
        return 'Not enough gas for the network fee. Check the wallet is on Polygon, then try again.'
      }
      return typeof e.code === 'number' ? `${msg} (code ${e.code})` : msg
    }
    try {
      const json = JSON.stringify(err)
      if (json && json !== '{}') return json.slice(0, 200)
    } catch {
      // circular; fall through
    }
  }
  return 'The wallet stopped without saying why. Check its activity before another attempt.'
}

export type EvmErrorKind = 'rejected' | 'chain_missing' | 'unsupported' | 'unavailable' | 'unknown'

export function classifyEvmError(err: unknown): EvmErrorKind {
  if (err instanceof EvmUnavailableError) return 'unavailable'
  switch (evmErrorCode(err)) {
    case 4001:
      return 'rejected'
    case 4902:
      return 'chain_missing'
    case 4200:
      return 'unsupported'
    default:
      return 'unknown'
  }
}
