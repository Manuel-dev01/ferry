import type { FonbnkChannel } from '@ferry/shared'

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
