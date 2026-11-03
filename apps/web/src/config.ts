/** Development only: fake Nimiq Pay providers so the app runs in a desktop browser. */
export const MOCK_WALLET = import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true'

/**
 * Add money (Fonbnk's buy form). Off since 2026-11-03: Fonbnk now asks the buyer to connect a
 * wallet with WalletConnect instead of pasting an address, and Nimiq Pay can't connect from inside
 * Ferry, so the flow dead-ends. Past top-ups stay viewable from History.
 */
export const ADD_MONEY_OPEN = false

export const REPO_URL = 'https://github.com/Manuel-dev01/ferry'
export const SUPPORT_URL = `${REPO_URL}/issues`
