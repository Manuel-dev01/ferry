// Development-only stand-ins for Nimiq Pay's providers, so the whole flow runs in a desktop
// browser. The EVM side signs with a real throwaway key kept in localStorage, so the API
// verifies genuine EIP-712 signatures. Nothing here can reach a real wallet or real funds.
import { NimiqProviderError, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { formatUsdt } from '@ferry/shared'
import {
  decodeFunctionData,
  erc20Abi,
  hexToString,
  isHex,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { askApproval } from './mockApproval'

const KEY_STORAGE = 'ferry.dev.mockKey'
export const MOCK_NIM_ADDRESS = 'NQ07 FERR YDEV MOCK 0000 0000 0000 0000'
export const MOCK_BALANCES = { usdt: 125_500_000n, pol: 0n, nimLuna: 4_200_000_00000 }

function devKey(): Hex {
  try {
    const stored = localStorage.getItem(KEY_STORAGE)
    if (stored && /^0x[0-9a-f]{64}$/i.test(stored)) return stored as Hex
    const key = generatePrivateKey()
    localStorage.setItem(KEY_STORAGE, key)
    return key
  } catch {
    return generatePrivateKey()
  }
}

const account = privateKeyToAccount(devKey())

const CONNECTED_KEY = 'ferry.dev.connected'
function isRemembered(): boolean {
  try {
    return sessionStorage.getItem(CONNECTED_KEY) === '1'
  } catch {
    return false
  }
}
function rememberConnection() {
  try {
    sessionStorage.setItem(CONNECTED_KEY, '1')
  } catch {
    // storage unavailable: the connection lasts until reload
  }
}
const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 })

function describeTypedData(raw: string) {
  try {
    const td = JSON.parse(raw) as {
      domain?: { name?: string }
      message?: { nonce?: string; functionSignature?: Hex }
    }
    const lines = [{ label: 'Contract', value: td.domain?.name ?? 'unknown' }]
    if (td.message?.functionSignature) {
      const call = decodeFunctionData({ abi: erc20Abi, data: td.message.functionSignature })
      if (call.functionName === 'transfer') {
        const [to, amount] = call.args
        lines.push(
          { label: 'Transfer', value: `${formatUsdt(amount)} USDT` },
          { label: 'To', value: to },
        )
      }
    }
    lines.push({ label: 'Nonce', value: td.message?.nonce ?? '?' })
    return lines
  } catch {
    return [{ label: 'Data', value: raw.slice(0, 80) }]
  }
}

// Starts on Ethereum, like a wallet last used elsewhere, so flows must switch to Polygon themselves.
let chainId: Hex = '0x1'

const ethereum = {
  async request({ method, params }: { method: string; params?: unknown[] }) {
    switch (method) {
      case 'eth_requestAccounts':
        if (
          !(await askApproval('Connect Ferry to your wallet?', [
            { label: 'Account', value: account.address },
          ]))
        )
          throw rejected()
        rememberConnection()
        return [account.address]
      case 'eth_accounts':
        // Like a real wallet: only an account the user already approved, never a prompt.
        return isRemembered() ? [account.address] : []
      case 'eth_chainId':
        return chainId
      case 'wallet_switchEthereumChain': {
        const target = (params?.[0] as { chainId: Hex }).chainId
        if (!(await askApproval('Switch network?', [{ label: 'Chain', value: target }])))
          throw rejected()
        chainId = target
        return null
      }
      case 'eth_signTypedData_v4': {
        const raw = String(params?.[1] ?? '')
        if (!(await askApproval('Sign this request?', describeTypedData(raw)))) throw rejected()
        const td = JSON.parse(raw)
        return account.signTypedData({
          domain: td.domain,
          types: td.types,
          primaryType: td.primaryType,
          message: td.message,
        })
      }
      case 'personal_sign': {
        const message = String(params?.[0] ?? '')
        const text = isHex(message) ? hexToString(message) : message
        if (
          !(await askApproval('Sign this message?', [
            { label: 'Message', value: text.slice(0, 120) },
          ]))
        )
          throw rejected()
        return account.signMessage({ message: isHex(message) ? { raw: message } : message })
      }
      case 'eth_sendTransaction': {
        // Shown, never broadcast: the hash is made up, so nothing moves.
        const tx = params?.[0] as { to: string; data?: string }
        if (
          !(await askApproval('Confirm transaction?', [
            { label: 'To', value: tx.to },
            { label: 'Data', value: (tx.data ?? '0x').slice(0, 42) },
          ]))
        )
          throw rejected()
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
      }
      default:
        throw Object.assign(new Error(`Mock wallet does not support ${method}`), { code: 4200 })
    }
  },
  on() {},
  removeListener() {},
} as unknown as EIP1193Provider

const permissionDenied = () =>
  new NimiqProviderError('PERMISSION_DENIED', 'User denied the request', 4001)

const nimiq = {
  async listAccounts() {
    if (
      !(await askApproval('Share your Nimiq address?', [
        { label: 'Address', value: MOCK_NIM_ADDRESS },
      ]))
    ) {
      throw permissionDenied()
    }
    return [MOCK_NIM_ADDRESS]
  },
  async getBalance() {
    return MOCK_BALANCES.nimLuna
  },
  async isConsensusEstablished() {
    return true
  },
  async sign() {
    if (!(await askApproval('Sign a message?'))) throw permissionDenied()
    throw new NimiqProviderError('UNKNOWN_REQUEST', 'Mock wallet cannot sign Nimiq messages', 4200)
  },
  async payLightningInvoice() {
    if (!(await askApproval('Pay this Lightning invoice?'))) throw permissionDenied()
    return { hash: `mock-${Date.now()}`, swapId: 'mock-swap' }
  },
} as unknown as NimiqProvider

export function installMockWallet(): NimiqProvider {
  window.ethereum = ethereum
  return nimiq
}

export const mockEvmAddress = account.address
