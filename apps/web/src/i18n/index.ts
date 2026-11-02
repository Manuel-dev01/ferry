import { createI18n } from 'vue-i18n'
import en from './en.json'

export type MessageSchema = typeof en

export const SUPPORTED_LOCALES = ['en', 'fr', 'pt', 'sw'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** Each language in its own name, for the picker in Settings. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  pt: 'Português',
  sw: 'Kiswahili',
}

const STORAGE_KEY = 'ferry.locale'

// Loaded on demand, so English users don't download the other languages. Missing keys fall back
// to English (the retired Paycrest screens are English-only).
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: unknown }>> = {
  fr: () => import('./fr.json'),
  pt: () => import('./pt.json'),
  sw: () => import('./sw.json'),
}

const isLocale = (v: unknown): v is Locale =>
  typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v)

/** Host language first ("pt-BR" counts as "pt"), then English. */
export function pickLocale(hostLanguage: string): Locale {
  const base = hostLanguage.toLowerCase().split(/[-_]/)[0]
  return isLocale(base) ? base : 'en'
}

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isLocale(v) ? v : null
  } catch {
    return null
  }
}

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en },
    missingWarn: false,
    fallbackWarn: false,
  })
}

let i18n: ReturnType<typeof makeI18n> | null = null

// The message types only describe English; other locales are partial copies of it.
const global = () =>
  i18n!.global as unknown as {
    locale: { value: string }
    availableLocales: string[]
    setLocaleMessage: (locale: string, messages: unknown) => void
  }

/** Picks the user's choice, else Nimiq Pay's language, and loads it before the app renders. */
export async function createAppI18n(hostLanguage: string) {
  i18n = makeI18n()
  await setLocale(storedLocale() ?? pickLocale(hostLanguage), false).catch(() => undefined)
  return i18n
}

export async function setLocale(locale: Locale, remember = true) {
  const g = global()
  if (locale !== 'en' && !g.availableLocales.includes(locale)) {
    g.setLocaleMessage(locale, (await loaders[locale]()).default)
  }
  g.locale.value = locale
  document.documentElement.lang = locale
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      // storage unavailable: the choice lasts until the app closes
    }
  }
}

/** True when the user picked a language in Settings, rather than following Nimiq Pay. */
export const localeIsChosen = () => storedLocale() !== null

/** Forgets the user's pick and follows Nimiq Pay's language again. */
export async function followHostLocale(hostLanguage: string) {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable: nothing was stored
  }
  await setLocale(pickLocale(hostLanguage), false)
}

export const currentLocale = (): Locale => {
  const v = i18n ? global().locale.value : 'en'
  return isLocale(v) ? v : 'en'
}
