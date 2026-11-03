/** Development only: fake Nimiq Pay providers so the app runs in a desktop browser. */
export const MOCK_WALLET = import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true'

/**
 * Add money (Fonbnk's buy form). Fonbnk asks the buyer to connect a wallet over WalletConnect, so
 * Ferry answers as that wallet (lib/wcBridge.ts). Set to false to hide the flow again; past top-ups
 * stay viewable from History either way.
 */
export const ADD_MONEY_OPEN = true

/** Reown (WalletConnect) project ID. Public by design: it names Ferry to the relay, and the
 * project only accepts Ferry's own domains. */
export const WC_PROJECT_ID =
  import.meta.env.VITE_WC_PROJECT_ID || '326b1b3ed445b95d15131e757bf0ee9b'

export const REPO_URL = 'https://github.com/Manuel-dev01/ferry'
export const SUPPORT_URL = `${REPO_URL}/issues`
