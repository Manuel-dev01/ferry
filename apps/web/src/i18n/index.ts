import { createI18n } from 'vue-i18n'
import en from './en.json'

export type MessageSchema = typeof en

export const SUPPORTED_LOCALES = ['en'] as const

/** Host language first, then English. More locales arrive in M7. */
export function pickLocale(hostLanguage: string): (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(hostLanguage)
    ? (hostLanguage as (typeof SUPPORTED_LOCALES)[number])
    : 'en'
}

export function createAppI18n(hostLanguage: string) {
  return createI18n<[MessageSchema], 'en', false>({
    legacy: false,
    locale: pickLocale(hostLanguage),
    fallbackLocale: 'en',
    messages: { en },
  })
}
