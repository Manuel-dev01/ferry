import { FONBNK_COUNTRIES, type FonbnkChannel, type FonbnkCountry } from '@ferry/shared'
import { currentLocale } from '../i18n'

const displayNames = new Map<string, Intl.DisplayNames | null>()

/** A country's name in the app's language, from the browser's own data; English as written. */
export function countryName(code: FonbnkCountry): string {
  const locale = currentLocale()
  if (locale !== 'en') {
    let names = displayNames.get(locale)
    if (names === undefined) {
      try {
        names = new Intl.DisplayNames([locale], { type: 'region' })
      } catch {
        names = null
      }
      displayNames.set(locale, names)
    }
    const name = names?.of(code)
    if (name && name !== code) return name
  }
  return FONBNK_COUNTRIES[code].name
}

/** "GM" → 🇬🇲, built from regional indicator letters, so every country works without a table. */
export function flagOf(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return ''
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

type T = (key: string) => string
type Te = (key: string) => boolean

/** "M-Pesa" in Kenya, "Mobile money" where there's no local name, "Bank account" for banks. */
export function channelLabel(t: T, te: Te, country: string, channel: FonbnkChannel | string) {
  const local = `fonbnk.channelsByCountry.${country}.${channel}`
  return te(local) ? t(local) : t(`fonbnk.channelNames.${channel}`)
}
