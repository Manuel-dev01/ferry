<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '../components/AppHeader.vue'
import Icon from '../components/Icon.vue'
import { REPO_URL, SUPPORT_URL } from '../config'
import { tinyAddress } from '../lib/names'
import { getAppearance, setAppearance, type Appearance } from '../lib/theme'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()

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
        <div class="fy-row fy-row--link">
          <span class="fy-row__k">{{ t('settings.language') }}</span>
          <span class="fy-row__v">{{ t('settings.english') }}</span>
        </div>
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
  </main>
</template>
