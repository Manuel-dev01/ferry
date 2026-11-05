// Fonbnk's buy form only connects wallets over WalletConnect, and Nimiq Pay's wallet isn't reachable
// from inside Fonbnk's frame. So Ferry answers as that WalletConnect wallet: it pairs from a link
// the user pastes, shares the address Nimiq Pay already gave Ferry, and passes sign-in requests to
// Nimiq Pay one tap at a time. It refuses anything that would move money.
import type { WalletKitTypes } from '@reown/walletkit'
import type { Address } from 'viem'
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
