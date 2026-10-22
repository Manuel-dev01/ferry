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
          rpcUrls: ['https://polygon-rpc.com'],
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

/** Approval: a normal transaction the user pays gas for. */
export async function sendTransaction(tx: { from: Address; to: Address; data: Hex }): Promise<Hex> {
  return provider().request({ method: 'eth_sendTransaction', params: [tx] })
}

export function evmErrorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'number') {
    return err.code
  }
  return undefined
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
