import { createRenderer, nextTick, ssrContextKey } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Strip from '../src/components/WalletConnectStrip.vue'

const bridge = vi.hoisted(() => {
  const handlers: Record<string, (event: unknown) => void> = {}
  return {
    handlers,
    kit: {
      on: vi.fn((name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler
      }),
      off: vi.fn(),
      pair: vi.fn().mockResolvedValue(undefined),
      getActiveSessions: vi.fn(() => ({ stale: { topic: 'stale' } })),
      disconnectSession: vi.fn().mockResolvedValue(undefined),
    },
    approve: vi.fn().mockResolvedValue({ topic: 'current' }),
    refuse: vi.fn().mockResolvedValue(undefined),
    answer: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('../src/lib/wcBridge', () => ({
  walletKit: async () => bridge.kit,
  approve: bridge.approve,
  reject: vi.fn().mockResolvedValue(undefined),
  refuse: bridge.refuse,
  answer: bridge.answer,
  fromFonbnk: () => true,
  parseWcLink: (text: string) => (text.startsWith('wc:') ? text : null),
  wcLinkExpired: () => false,
  isSignMethod: (method: string) =>
    ['personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4'].includes(method),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

type Node = { children: Node[]; parent?: Node; text?: string }
const renderer = createRenderer<Node, Node>({
  createElement: () => ({ children: [] }),
  createText: (text) => ({ children: [], text }),
  createComment: () => ({ children: [] }),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
  },
  parentNode: (node) => node.parent ?? null,
  nextSibling: () => null,
  patchProp: () => {},
  insert: (node, parent) => {
    node.parent = parent
    parent.children.push(node)
  },
  remove: (node) => {
    if (node.parent) node.parent.children = node.parent.children.filter((n) => n !== node)
  },
})
let app: ReturnType<typeof renderer.createApp>
const flush = async () => {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}
async function mount() {
  app = renderer.createApp(Strip, { address: '0x1111111111111111111111111111111111111111' })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({ children: [] })
  await flush()
  // Script-setup state is internal to the component; exercise its event handlers directly.
  return (
    app._instance as unknown as {
      setupState: {
        state: string
        showInput: boolean
        request: unknown
        pairWith: (link: string) => Promise<void>
        share: () => Promise<void>
        reconnect: () => Promise<void>
      }
    }
  ).setupState
}
afterEach(() => {
  app?.unmount()
  vi.clearAllMocks()
})

describe('Fonbnk connection lifecycle', () => {
  it('handles read-only connection checks without prompting or refusing a transaction', async () => {
    const state = await mount()
    await state.pairWith('wc:fresh')
    bridge.handlers.session_proposal!({ id: 10 })
    await state.share()
    for (const [method, params, result] of [
      ['eth_chainId', [], '0x89'],
      ['eth_accounts', [], ['0x1111111111111111111111111111111111111111']],
      ['wallet_switchEthereumChain', [{ chainId: '0x89' }], null],
    ] as const) {
      const r = { topic: 'current', params: { chainId: 'eip155:1', request: { method, params } } }
      bridge.handlers.session_request!(r)
      expect(bridge.answer).toHaveBeenCalledWith(r, result)
    }
    const transfer = {
      topic: 'current',
      params: { chainId: 'eip155:137', request: { method: 'eth_sendTransaction', params: [] } },
    }
    bridge.handlers.session_request!(transfer)
    expect(bridge.refuse).toHaveBeenCalledWith(transfer)
  })
  it('queues a request arriving before session approval finishes', async () => {
    let finish!: (value: { topic: string }) => void
    bridge.approve.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r
        }),
    )
    const state = await mount()
    await state.pairWith('wc:fresh')
    bridge.handlers.session_proposal!({ id: 11 })
    const sharing = state.share()
    const r = {
      topic: 'current',
      params: { chainId: 'eip155:137', request: { method: 'eth_accounts', params: [] } },
    }
    bridge.handlers.session_request!(r)
    expect(bridge.refuse).not.toHaveBeenCalledWith(r)
    finish({ topic: 'current' })
    await sharing
    expect(bridge.answer).toHaveBeenCalledWith(r, ['0x1111111111111111111111111111111111111111'])
  })
  it('does not report a saved session as connected to a fresh frame', async () => {
    const state = await mount()
    expect(state.state).toBe('idle')
    expect(bridge.kit.getActiveSessions).not.toHaveBeenCalled()
  })

  it('allows recovery after approval and ignores unrelated disconnects', async () => {
    const state = await mount()
    await state.pairWith('wc:fresh')
    bridge.handlers.session_proposal!({ id: 1 })
    await state.share()
    expect(state.state).toBe('connected')
    bridge.handlers.session_delete!({ topic: 'stale' })
    expect(state.state).toBe('connected')
    await state.reconnect()
    expect(state.state).toBe('idle')
    expect(state.showInput).toBe(true)
    expect(bridge.kit.disconnectSession).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'current' }),
    )
  })

  it('refuses requests from old sessions and disconnects the current session on exit', async () => {
    const state = await mount()
    await state.pairWith('wc:fresh')
    bridge.handlers.session_proposal!({ id: 2 })
    await state.share()
    const request = {
      topic: 'stale',
      params: { chainId: 'eip155:137', request: { method: 'personal_sign', params: [] } },
    }
    bridge.handlers.session_request!(request)
    expect(bridge.refuse).toHaveBeenCalledWith(request)
    expect(state.request).toBe(null)
    app.unmount()
    expect(bridge.kit.disconnectSession).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'current' }),
    )
  })
})
