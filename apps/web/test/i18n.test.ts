import { describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'
import fr from '../src/i18n/fr.json'
import { pickLocale } from '../src/i18n'
import pt from '../src/i18n/pt.json'
import sw from '../src/i18n/sw.json'

type Tree = { [key: string]: string | Tree }

function flat(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
    if (typeof value === 'string') out[prefix + key] = value
    else Object.assign(out, flat(value, `${prefix}${key}.`))
    return out
  }, {})
}

const english = flat(en as Tree)
const placeholders = (s: string) => (s.match(/\{[^}]*\}/g) ?? []).sort()

describe.each([
  ['fr', fr],
  ['pt', pt],
  ['sw', sw],
])('%s messages', (_, messages) => {
  const translated = flat(messages as Tree)

  it('only uses keys that exist in English', () => {
    expect(Object.keys(translated).filter((k) => !(k in english))).toEqual([])
  })

  it('keeps every placeholder, and only those', () => {
    const wrong = Object.entries(translated).filter(
      ([k, v]) => placeholders(v).join() !== placeholders(english[k] ?? '').join(),
    )
    expect(wrong.map(([k]) => k)).toEqual([])
  })

  it('has no vue-i18n syntax that would break a message', () => {
    const risky = Object.entries(translated).filter(
      ([, v]) => v.includes('|') || /@/.test(v.replaceAll("{'@'}", '')),
    )
    expect(risky.map(([k]) => k)).toEqual([])
  })

  it('covers every live screen', () => {
    // Retired screens (the dormant Paycrest flow) may stay English; everything else is translated.
    const retired =
      /^(institution|account|confirm|amount|review|sign|tracker|receipt|outcome)\.|^home\.demo|^settings\.english$|^country\.(rails|currency)\./
    const missing = Object.keys(english).filter((k) => !retired.test(k) && !(k in translated))
    expect(missing).toEqual([])
  })
})

describe('pickLocale', () => {
  it('matches the base language and falls back to English', () => {
    expect(pickLocale('pt-BR')).toBe('pt')
    expect(pickLocale('fr')).toBe('fr')
    expect(pickLocale('sw_KE')).toBe('sw')
    expect(pickLocale('de')).toBe('en')
    expect(pickLocale('')).toBe('en')
  })
})
