// Appearance: follow the system (and so Nimiq Pay) by default, or pin light/dark.
export type Appearance = 'system' | 'light' | 'dark'

const KEY = 'ferry.appearance'

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function setAppearance(a: Appearance) {
  try {
    if (a === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, a)
  } catch {
    // storage unavailable: applies for this session only
  }
  applyAppearance(a)
}

function applyAppearance(a: Appearance) {
  const root = document.documentElement
  if (a === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', a)
}

export const applyStoredTheme = () => applyAppearance(getAppearance())
