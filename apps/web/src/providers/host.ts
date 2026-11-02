import { getHostFiat, getHostLanguage, getHostNetwork } from '@nimiq/mini-app-sdk'
import { MOCK_WALLET } from '../config'

// Nimiq Pay injects these before page scripts run, so they are safe to read at module load.
export interface HostContext {
  language: string
  fiat: string | null
  network: 'mainnet' | 'testnet'
  /** True when Nimiq Pay's host context object is present. */
  inHost: boolean
}

export function readHostContext(): HostContext {
  if (MOCK_WALLET) {
    // ?fiat=KES lets you preview another corridor's defaults in the browser.
    const fiat = new URLSearchParams(window.location.search).get('fiat') ?? 'NGN'
    const language = navigator.language.split('-')[0] ?? 'en'
    return { language, fiat, network: 'mainnet', inHost: true }
  }
  const hostLanguage = getHostLanguage()
  return {
    language: hostLanguage ?? navigator.language.split('-')[0] ?? 'en',
    fiat: getHostFiat() ?? null,
    network: getHostNetwork() === 'testnet' ? 'testnet' : 'mainnet',
    inHost: typeof window !== 'undefined' && window.nimiqPay !== undefined,
  }
}

/** Universal link that opens this Mini App inside Nimiq Pay. */
export function openInNimiqPayUrl(): string {
  const origin = import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin
  return `https://nimpay.app/miniapps/open/${new URL(origin).host}`
}
