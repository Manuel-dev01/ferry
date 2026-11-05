// Light by default. System and dark remain explicit user choices.
export type Appearance = 'system' | 'light' | 'dark'

const KEY = 'ferry.appearance'

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

export function setAppearance(a: Appearance) {
  try {
    localStorage.setItem(KEY, a)
  } catch {
    // storage unavailable: applies for this session only
  }
  applyAppearance(a)
}

function applyAppearance(a: Appearance) {
  const root = document.documentElement
  if (a === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', a)
  const dark =
    a === 'dark' || (a === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0a0c2b' : '#fbf6ee')
}

export const applyStoredTheme = () => applyAppearance(getAppearance())
