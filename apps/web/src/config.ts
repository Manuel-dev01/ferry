/** Development only: fake Nimiq Pay providers so the app runs in a desktop browser. */
export const MOCK_WALLET = import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true'

export const SPIKES_ENABLED = import.meta.env.VITE_SPIKES === 'true'

export const REPO_URL = 'https://github.com/Manuel-dev01/ferry'
export const SUPPORT_URL = `${REPO_URL}/issues`
