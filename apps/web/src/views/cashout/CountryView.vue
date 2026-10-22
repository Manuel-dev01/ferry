<script setup lang="ts">
import { CORRIDORS, type CorridorCurrency } from '@ferry/shared'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import { FLAGS } from '../../lib/corridors'
import { useCashoutStore } from '../../stores/cashout'
import { useSessionStore } from '../../stores/session'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()

const corridors = computed(() =>
  CORRIDORS.map((c) => ({
    ...c,
    enabled: session.meta?.corridors.find((m) => m.currency === c.currency)?.enabled ?? true,
  })),
)
const paused = computed(() => corridors.value.filter((c) => !c.enabled))

function choose(currency: CorridorCurrency) {
  draft.setCurrency(currency)
  void router.push('/cashout/bank')
}
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/">{{ t('common.step', { step: 1, steps: 4 }) }}</AppHeader>
    <div class="fy-content">
      <div class="flex flex-col gap-2">
        <h1 class="fy-display">{{ t('country.title') }}</h1>
        <p class="fy-lede">{{ t('country.lede') }}</p>
      </div>
      <ul class="flex flex-col gap-2.5" role="list" style="margin: 0; padding: 0; list-style: none">
        <li v-for="c in corridors" :key="c.currency">
          <button
            type="button"
            class="w-full flex items-center gap-3.5 text-left"
            style="
              min-height: 80px;
              border-radius: 20px;
              padding: 0 16px;
              background: var(--fy-surface);
              box-shadow: inset 0 0 0 1px var(--fy-line);
            "
            :style="
              draft.currency === c.currency
                ? { boxShadow: 'inset 0 0 0 2px var(--fy-brand)' }
                : undefined
            "
            :disabled="!c.enabled"
            @click="choose(c.currency)"
          >
            <span style="font-size: 32px; line-height: 1" aria-hidden="true">{{
              FLAGS[c.currency]
            }}</span>
            <span class="flex-1 min-w-0 flex flex-col gap-0.5">
              <span style="font: 700 17px var(--fy-font-body)">{{ c.name }}</span>
              <span style="font-size: 13.5px; color: var(--fy-ink-2)">{{
                t(`country.rails.${c.currency}`)
              }}</span>
            </span>
            <span
              v-if="c.enabled"
              class="flex items-center gap-1.5"
              style="font: 600 13px var(--fy-font-body); color: var(--fy-ink-2)"
            >
              {{ t(`country.currency.${c.currency}`) }}<Icon name="forward" :size="18" />
            </span>
            <span v-else class="flex flex-col items-end gap-1">
              <span class="fy-chip fy-chip--warning">{{ t('country.paused') }}</span>
              <span style="font-size: 12px; color: var(--fy-ink-2)">{{
                t('country.backSoon')
              }}</span>
            </span>
          </button>
        </li>
      </ul>
      <Banner
        v-for="p in paused"
        :key="p.currency"
        tone="warning"
        :body="t('country.pausedBanner', { country: p.name })"
      />
    </div>
  </main>
</template>
