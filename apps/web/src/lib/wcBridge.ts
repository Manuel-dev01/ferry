// Fonbnk's buy form only connects wallets over WalletConnect, and Nimiq Pay's wallet isn't reachable
// from inside Fonbnk's frame. So Ferry answers as that WalletConnect wallet: it pairs from a link
// the user pastes, shares the address Nimiq Pay already gave Ferry, and passes sign-in requests to
// Nimiq Pay one tap at a time. It refuses anything that would move money, except on a cash-out:
// there it accepts Fonbnk's request for the USDT payment (see parseUsdtPayment), shows it, and
// sends it through Ferry's own send flow.
import type { WalletKitTypes } from '@reown/walletkit'
import { USDT0_ADDRESS } from '@ferry/shared'
import { decodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from 'viem'
import { WC_PROJECT_ID } from '../config'

type WalletKit = Awaited<ReturnType<(typeof import('@reown/walletkit'))['WalletKit']['init']>>

let kitPromise: Promise<WalletKit> | null = null

/** Loaded on first use only: the SDK is large and only Add money needs it. */
export function walletKit(): Promise<WalletKit> {
  kitPromise ??= (async () => {
    const [{ Core }, { WalletKit }] = await Promise.all([
      import('@walletconnect/core'),
      import('@reown/walletkit'),
    ])
    return WalletKit.init({
      core: new Core({ projectId: WC_PROJECT_ID }),
      metadata: {
        name: 'Ferry',
        description: 'Cash out and add money from Nimiq Pay',
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.svg`],
      },
    })
  })().catch((err: unknown) => {
    kitPromise = null
    throw err
  })
  return kitPromise
}

/** A WalletConnect v2 pairing link, as Fonbnk's "Copy link" gives it. */
export function parseWcLink(text: string): string | null {
  let link = text.trim()
  try {
    if (/^https?:/i.test(link)) link = new URL(link).searchParams.get('uri') ?? ''
    if (/^wc%3a/i.test(link)) link = decodeURIComponent(link)
    if (!/^wc:[0-9a-f]{64}@2\?/i.test(link)) return null
    const params = new URLSearchParams(link.split('?')[1])
    return /^[0-9a-f]{64}$/i.test(params.get('symKey') ?? '') &&
      params.get('relay-protocol') === 'irn'
      ? link
      : null
  } catch {
    return null
  }
}

export function wcLinkExpired(link: string, now = Date.now()) {
  const expiry = new URLSearchParams(link.split('?')[1]).get('expiryTimestamp')
  return expiry !== null && (!/^\d+$/.test(expiry) || BigInt(expiry) * 1000n <= BigInt(now))
}

/** Methods Ferry will pass to Nimiq Pay, each after its own tap. Everything else is refused. */
export const SIGN_METHODS = ['personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData'] as const
export type SignMethod = (typeof SIGN_METHODS)[number]
/** Methods a site may list for the session; requests for the money-moving ones are refused. */
const LISTED_METHODS = [
  ...SIGN_METHODS,
  'eth_sendTransaction',
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
]
const POLYGON = 'eip155:137'

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}
const isFonbnkHost = (host: string) => host === 'fonbnk.com' || host.endsWith('.fonbnk.com')

/** Only Fonbnk may connect: a link pasted from anywhere else is turned down. */
export function fromFonbnk(proposal: WalletKitTypes.SessionProposal): boolean {
  const claimed = hostOf(proposal.params.proposer.metadata.url)
  const verified = proposal.verifyContext?.verified
  if (verified?.isScam || verified?.validation === 'INVALID') return false
  const origin = hostOf(verified?.origin)
  return isFonbnkHost(claimed) && (!origin || isFonbnkHost(origin))
}

/** Grants the site the user's address on the chains it needs, Polygon always among them. */
export async function approve(proposal: WalletKitTypes.SessionProposal, address: Address) {
  const { buildApprovedNamespaces } = await import('@walletconnect/utils')
  const asked = [
    ...(proposal.params.requiredNamespaces.eip155?.chains ?? []),
    ...(proposal.params.optionalNamespaces?.eip155?.chains ?? []),
  ]
  const chains = [...new Set([POLYGON, ...asked.filter((c) => c.startsWith('eip155:'))])]
  const namespaces = buildApprovedNamespaces({
    proposal: proposal.params,
    supportedNamespaces: {
      eip155: {
        chains,
        methods: LISTED_METHODS,
        events: ['accountsChanged', 'chainChanged'],
        accounts: chains.map((c) => `${c}:${address}`),
      },
    },
  })
  const kit = await walletKit()
  return kit.approveSession({ id: proposal.id, namespaces })
}

export async function reject(proposal: WalletKitTypes.SessionProposal) {
  const { getSdkError } = await import('@walletconnect/utils')
  const kit = await walletKit()
  await kit.rejectSession({ id: proposal.id, reason: getSdkError('USER_REJECTED') })
}

export async function answer(request: WalletKitTypes.SessionRequest, result: unknown) {
  const kit = await walletKit()
  await kit.respondSessionRequest({
    topic: request.topic,
    response: { id: request.id, jsonrpc: '2.0', result },
  })
}

export async function refuse(request: WalletKitTypes.SessionRequest) {
  const { getSdkError } = await import('@walletconnect/utils')
  const kit = await walletKit()
  await kit.respondSessionRequest({
    topic: request.topic,
    response: { id: request.id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') },
  })
}

export const isSignMethod = (method: string): method is SignMethod =>
  (SIGN_METHODS as readonly string[]).includes(method)

/**
 * A payment Fonbnk asked for. `settle` answers Fonbnk once: the hash, or null to refuse. It resolves
 * to false when Fonbnk could not be told (the session closed or the answer failed).
 */
export type WcPayment = {
  to: Address
  units: bigint
  settle: (hash: Hex | null) => Promise<boolean>
}

/**
 * On a cash-out, Fonbnk asks the wallet to pay its deposit address. Ferry accepts exactly one
 * shape: a plain USDT `transfer` on Polygon from this wallet, with no POL attached. Anything else
 * returns null and is refused. Ferry then builds and sends its own transfer, not Fonbnk's object.
 */
export function parseUsdtPayment(
  tx: unknown,
  from: Address,
): { to: Address; units: bigint } | null {
  if (!tx || typeof tx !== 'object') return null
  const { to, from: sender, data, value } = tx as Record<string, unknown>
  if (typeof to !== 'string' || !isAddress(to, { strict: false })) return null
  if (getAddress(to) !== getAddress(USDT0_ADDRESS)) return null
  if (
    sender !== undefined &&
    (typeof sender !== 'string' || sender.toLowerCase() !== from.toLowerCase())
  )
    return null
  if (value !== undefined && value !== null && !/^(0x0*|0*)$/i.test(String(value))) return null
  if (typeof data !== 'string' || !/^0x[0-9a-f]{136}$/i.test(data)) return null
  try {
    const call = decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` })
    if (call.functionName !== 'transfer') return null
    const [recipient, units] = call.args
    const payee = getAddress(recipient)
    if (units <= 0n || payee === getAddress(from) || payee === getAddress(USDT0_ADDRESS))
      return null
    return { to: payee, units }
  } catch {
    return null
  }
}
