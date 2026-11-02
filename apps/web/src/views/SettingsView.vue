<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '../components/AppHeader.vue'
import Icon from '../components/Icon.vue'
import { REPO_URL, SUPPORT_URL } from '../config'
import {
  currentLocale,
  followHostLocale,
  LOCALE_NAMES,
  localeIsChosen,
  pickLocale,
  setLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from '../i18n'
import { tinyAddress } from '../lib/names'
import { getAppearance, setAppearance, type Appearance } from '../lib/theme'
import { readHostContext } from '../providers/host'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()

// ---- Language: Ferry's own sheet, so it looks the same on every phone ----

const hostLanguage = readHostContext().language
const hostLocale = pickLocale(hostLanguage)
const locale = ref<Locale>(currentLocale())
/** 'host' while Ferry follows Nimiq Pay's language. */
const picked = ref<Locale | 'host'>(localeIsChosen() ? currentLocale() : 'host')
const langOpen = ref(false)
const langRow = ref<HTMLButtonElement | null>(null)
const sheet = ref<HTMLElement | null>(null)

/** A language's name in the language the app shows now, e.g. "French" under "Français". */
function nameHere(l: Locale): string {
  try {
    const name = new Intl.DisplayNames([locale.value], { type: 'language' }).of(l)
    return name && name.toLowerCase() !== LOCALE_NAMES[l].toLowerCase() ? name : ''
  } catch {
    return ''
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeLanguages()
}
async function openLanguages() {
  langOpen.value = true
  window.addEventListener('keydown', onKey)
  await nextTick()
  sheet.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
}
function closeLanguages() {
  langOpen.value = false
  window.removeEventListener('keydown', onKey)
  langRow.value?.focus()
}
onUnmounted(() => window.removeEventListener('keydown', onKey))

async function chooseLocale(next: Locale | 'host') {
  await (next === 'host' ? followHostLocale(hostLanguage) : setLocale(next)).catch(() => undefined)
  locale.value = currentLocale()
  picked.value = next
  closeLanguages()
}

const appearance = ref<Appearance>(getAppearance())
const ORDER: Appearance[] = ['system', 'light', 'dark']
function cycleAppearance() {
  appearance.value = ORDER[(ORDER.indexOf(appearance.value) + 1) % ORDER.length]!
  setAppearance(appearance.value)
}
const appearanceLabel = () =>
  appearance.value === 'system'
    ? t('settings.appearanceSystem')
    : appearance.value === 'light'
      ? t('settings.appearanceLight')
      : t('settings.appearanceDark')
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/" :title="t('settings.title')" />
    <div class="fy-content" style="padding-top: 4px">
      <div class="fy-panel">
        <button
          ref="langRow"
          type="button"
          class="fy-row fy-row--link"
          aria-haspopup="dialog"
          :aria-expanded="langOpen"
          @click="openLanguages"
        >
          <span class="fy-row__k">{{ t('settings.language') }}</span>
          <span class="fy-row__v"
            >{{ LOCALE_NAMES[locale] }}<Icon name="forward" :size="16"
          /></span>
        </button>
        <button type="button" class="fy-row fy-row--link" @click="cycleAppearance">
          <span class="fy-row__k">{{ t('settings.appearance') }}</span>
          <span class="fy-row__v" aria-live="polite"
            >{{ appearanceLabel() }}<Icon name="forward" :size="16"
          /></span>
        </button>
      </div>

      <div class="fy-panel">
        <a :href="SUPPORT_URL" target="_blank" rel="noopener" class="fy-row fy-row--link">
          <span class="fy-row__k">{{ t('settings.support') }}</span>
          <span class="fy-row__v"
            >{{ t('settings.supportValue') }}<Icon name="external" :size="16"
          /></span>
        </a>
        <RouterLink to="/privacy" class="fy-row fy-row--link">
          <span class="fy-row__k">{{ t('settings.privacy') }}</span>
          <span class="fy-row__v"><Icon name="forward" :size="16" /></span>
        </RouterLink>
        <RouterLink to="/terms" class="fy-row fy-row--link">
          <span class="fy-row__k">{{ t('settings.terms') }}</span>
          <span class="fy-row__v"><Icon name="forward" :size="16" /></span>
        </RouterLink>
        <a :href="REPO_URL" target="_blank" rel="noopener" class="fy-row fy-row--link">
          <span class="fy-row__k">{{ t('settings.openSource') }}</span>
          <span class="fy-row__v"
            >{{ t('settings.openSourceValue') }}<Icon name="external" :size="16"
          /></span>
        </a>
      </div>

      <div class="fy-panel">
        <div class="fy-row fy-row--link">
          <span class="flex flex-col gap-0.5">
            <span class="fy-row__k">{{ t('settings.wallet') }}</span>
            <span style="font-size: 13px; color: var(--fy-ink-2)">
              {{
                session.evmAddress ? tinyAddress(session.evmAddress) : t('settings.notConnected')
              }}
            </span>
          </span>
          <button
            v-if="session.evmAddress"
            type="button"
            class="fy-btn fy-btn--secondary fy-btn--sm"
            style="font-size: 14px"
            @click="session.disconnectEvm()"
          >
            {{ t('settings.disconnect') }}
          </button>
        </div>
      </div>

      <p class="fy-caption text-center" style="line-height: 1.5">{{ t('settings.footer') }}</p>
    </div>

    <Teleport to="body">
      <Transition name="s-sheet">
        <div v-if="langOpen" class="sheet-backdrop" @click.self="closeLanguages">
          <section
            ref="sheet"
            class="sheet s-langsheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lang-title"
          >
            <span class="s-grab" aria-hidden="true" />
            <h2 id="lang-title" class="s-langsheet__title">{{ t('settings.language') }}</h2>
            <div class="s-langs" role="radiogroup" aria-labelledby="lang-title">
              <button
                type="button"
                role="radio"
                class="s-lang"
                :aria-checked="picked === 'host'"
                @click="chooseLocale('host')"
              >
                <span class="s-lang__names">
                  <strong>{{ t('settings.appearanceSystem') }}</strong>
                  <span>{{ LOCALE_NAMES[hostLocale] }}</span>
                </span>
                <Icon v-if="picked === 'host'" name="check" :size="18" :stroke="3" />
              </button>
              <button
                v-for="l in SUPPORTED_LOCALES"
                :key="l"
                type="button"
                role="radio"
                class="s-lang"
                :lang="l"
                :aria-checked="picked === l"
                @click="chooseLocale(l)"
              >
                <span class="s-lang__names">
                  <strong>{{ LOCALE_NAMES[l] }}</strong>
                  <span v-if="nameHere(l)" :lang="locale">{{ nameHere(l) }}</span>
                </span>
                <Icon v-if="picked === l" name="check" :size="18" :stroke="3" />
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.s-langsheet {
  background: var(--fy-surface);
  padding-top: 10px;
}
.s-grab {
  display: block;
  width: 40px;
  height: 5px;
  border-radius: 3px;
  margin: 0 auto 14px;
  background: var(--fy-line);
}
.s-langsheet__title {
  margin: 0 4px 12px;
  font: 800 20px/1.2 var(--fy-font-display);
  letter-spacing: -0.02em;
  color: var(--fy-ink);
}
.s-langs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.s-lang {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
  border: 1.5px solid var(--fy-line);
  border-radius: 16px;
  background: transparent;
  color: var(--fy-ink);
  text-align: left;
  cursor: pointer;
}
.s-lang[aria-checked='true'] {
  border-color: var(--fy-brand);
  background: var(--fy-brand-soft);
  color: var(--fy-brand);
}
.s-lang:focus-visible {
  outline: 2px solid var(--fy-brand);
  outline-offset: 2px;
}
.s-lang__names {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.s-lang__names strong {
  font: 700 16px var(--fy-font-body);
  color: var(--fy-ink);
}
.s-lang__names span {
  font: 500 13px var(--fy-font-body);
  color: var(--fy-ink-2);
}
.s-sheet-enter-active,
.s-sheet-leave-active {
  transition: opacity 0.2s ease;
}
.s-sheet-enter-active .sheet,
.s-sheet-leave-active .sheet {
  transition: transform 0.28s cubic-bezier(0.34, 1.2, 0.5, 1);
}
.s-sheet-enter-from,
.s-sheet-leave-to {
  opacity: 0;
}
.s-sheet-enter-from .sheet,
.s-sheet-leave-to .sheet {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .s-sheet-enter-active .sheet,
  .s-sheet-leave-active .sheet {
    transition: none;
  }
}
</style>
