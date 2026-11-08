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
vi.mock('../src/lib/wcBridge', async () => ({
  parseUsdtPayment: (
    await vi.importActual<typeof import('../src/lib/wcBridge')>('../src/lib/wcBridge')
  ).parseUsdtPayment,
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
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => false }) }))

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
async function mount(extra: Record<string, unknown> = {}) {
  app = renderer.createApp(Strip, {
    address: '0x1111111111111111111111111111111111111111',
    ...extra,
  })
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

  describe('cash-out payments', () => {
    const ME = '0x1111111111111111111111111111111111111111'
    const FONBNK = '0x2222222222222222222222222222222222222222'
    const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
    const transferData = (to: string, units: bigint) =>
      '0xa9059cbb' + to.slice(2).padStart(64, '0') + units.toString(16).padStart(64, '0')
    const payRequest = (id: number, tx: Record<string, unknown>) => ({
      id,
      topic: 'current',
      params: { chainId: 'eip155:137', request: { method: 'eth_sendTransaction', params: [tx] } },
    })
    async function connected(onPay: (p: unknown) => void) {
      const state = await mount({ pay: true, onPay })
      await state.pairWith('wc:fresh')
      bridge.handlers.session_proposal!({ id: 20 })
      await state.share()
      return state
    }

    it('hands a plain USDT transfer to the page and answers Fonbnk with the hash', async () => {
      const onPay = vi.fn()
      await connected(onPay)
      const r = payRequest(1, { from: ME, to: USDT, data: transferData(FONBNK, 5_000_000n) })
      bridge.handlers.session_request!(r)
      expect(bridge.refuse).not.toHaveBeenCalledWith(r)
      expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ to: FONBNK, units: 5_000_000n }))
      const hash = '0x' + 'ab'.repeat(32)
      await onPay.mock.calls[0]![0].settle(hash)
      expect(bridge.answer).toHaveBeenCalledWith(r, hash)
    })

    it('refuses anything that is not a plain USDT transfer', async () => {
      const onPay = vi.fn()
      await connected(onPay)
      for (const tx of [
        { to: FONBNK, data: transferData(FONBNK, 5_000_000n) }, // not the USDT contract
        { to: USDT, data: transferData(FONBNK, 5_000_000n), value: '0x1' }, // POL attached
        { to: USDT, data: transferData(FONBNK, 5_000_000n).replace('a9059cbb', '095ea7b3') }, // approve
      ]) {
        const r = payRequest(2, tx)
        bridge.handlers.session_request!(r)
        expect(bridge.refuse).toHaveBeenCalledWith(r)
      }
      expect(onPay).not.toHaveBeenCalled()
    })

    it('takes one payment at a time and refuses a pending one on exit', async () => {
      const onPay = vi.fn()
      await connected(onPay)
      const first = payRequest(3, { to: USDT, data: transferData(FONBNK, 5_000_000n) })
      const second = payRequest(4, { to: USDT, data: transferData(FONBNK, 5_000_000n) })
      bridge.handlers.session_request!(first)
      bridge.handlers.session_request!(second)
      expect(onPay).toHaveBeenCalledTimes(1)
      expect(bridge.refuse).toHaveBeenCalledWith(second)
      app.unmount()
      expect(bridge.refuse).toHaveBeenCalledWith(first)
    })

    it('still refuses transfers when not on a cash-out', async () => {
      const state = await mount()
      await state.pairWith('wc:fresh')
      bridge.handlers.session_proposal!({ id: 21 })
      await state.share()
      const r = payRequest(5, { to: USDT, data: transferData(FONBNK, 5_000_000n) })
      bridge.handlers.session_request!(r)
      expect(bridge.refuse).toHaveBeenCalledWith(r)
    })
  })
})
