import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  fallback,
  http,
  parseAbi,
  parseGwei,
  type Address,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'

export const metaTxAbi = parseAbi([
  'function getNonce(address user) view returns (uint256)',
  'function executeMetaTransaction(address userAddress, bytes functionSignature, bytes32 sigR, bytes32 sigS, uint8 sigV) payable returns (bytes)',
])

/** Polygon validators reject priority fees below ~25 gwei; stay above that floor. */
export const MIN_PRIORITY_FEE = parseGwei('30')
export const MAX_FEE_CAP = parseGwei('1000')

export function createPolygonClient(rpcUrls: string[]): PublicClient {
  return createPublicClient({
    chain: polygon,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
  })
}

export function createRelayerWallet(rpcUrls: string[], privateKey: `0x${string}`) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: polygon,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 15_000, retryCount: 0 }))),
  })
}

export type RelayerWallet = ReturnType<typeof createRelayerWallet>

export async function readBalances(client: PublicClient, token: Address, owner: Address) {
  const [usdt, pol] = await Promise.all([
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    }),
    client.getBalance({ address: owner }),
  ])
  return { usdt, pol }
}

/** EIP-1559 fees with Polygon's priority floor and a hard cap on the max fee. */
export async function polygonFees(client: PublicClient) {
  const estimate = await client.estimateFeesPerGas()
  const priority =
    estimate.maxPriorityFeePerGas > MIN_PRIORITY_FEE
      ? estimate.maxPriorityFeePerGas
      : MIN_PRIORITY_FEE
  const block = await client.getBlock()
  const base = block.baseFeePerGas ?? 0n
  const max = 2n * base + priority
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: max > MAX_FEE_CAP ? MAX_FEE_CAP : max,
  }
}
