<script setup lang="ts">
import { FONBNK_COUNTRIES, type StatsResponse } from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '../components/AppHeader.vue'
import Banner from '../components/Banner.vue'
import { api } from '../lib/api'
import { channelLabel, flagOf } from '../lib/fonbnk'
import {
  durationDisplay,
  roughDurationDisplay,
  shortTimeDisplay,
  timeDisplay,
  usdHeadline,
  usdtDisplay,
} from '../lib/format'

const { t, te } = useI18n()

const REFRESH_MS = 60_000

const stats = ref<StatsResponse | null>(null)
const failed = ref(false)
async function load() {
  try {
    stats.value = await api<StatsResponse>('/v1/stats')
    failed.value = false
  } catch {
    failed.value = !stats.value
  }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void load()
  timer = setInterval(() => void load(), REFRESH_MS)
})
onUnmounted(() => clearInterval(timer))

const usd = (units: string) => `$${usdtDisplay(BigInt(units))}`

const tiles = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { v: s.cashouts.toLocaleString('en'), k: t('proof.cashouts'), tone: 'cream' },
    { v: usdHeadline(BigInt(s.volumeUnits)), k: t('proof.volume'), tone: 'cream' },
    { v: s.uniqueWallets.toLocaleString('en'), k: t('proof.wallets'), tone: 'mint' },
    { v: String(s.countries), k: t('proof.countries'), tone: 'mint' },
    {
      v: s.medianSeconds !== null ? roughDurationDisplay(s.medianSeconds * 1000) : t('proof.soon'),
      k:
        s.medianSeconds !== null
          ? t('proof.median')
          : `${t('proof.median')} · ${t('proof.afterFirst')}`,
      tone: 'tangerine',
    },
    { v: s.confirmedPaid.toLocaleString('en'), k: t('proof.confirmed'), tone: 'tangerine' },
  ]
})

const maxCountry = computed(() =>
  Math.max(1, ...(stats.value?.byCountry.map((c) => c.cashouts) ?? [])),
)
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/">{{ t('proof.header') }}</AppHeader>
    <div class="fy-content" style="gap: 22px">
      <div class="flex flex-col gap-2">
        <span class="s-live"
          ><span class="s-live__dot" aria-hidden="true" />{{
            stats ? t('proof.live', { time: timeDisplay(stats.updatedAt) }) : t('proof.loading')
          }}</span
        >
        <h1 class="fy-display">{{ t('proof.title') }}</h1>
        <p class="fy-lede">{{ t('proof.lede') }}</p>
      </div>

      <Banner v-if="failed" tone="danger" :body="t('proof.failed')" />

      <!-- Loading -->
      <div v-if="!stats && !failed" class="s-grid" aria-busy="true">
        <span
          v-for="i in 6"
          :key="i"
          class="fy-skel fy-skel--shimmer"
          style="height: 96px; border-radius: 20px"
        />
      </div>

      <template v-if="stats">
        <div class="s-grid">
          <div v-for="s in tiles" :key="s.k" class="s-tile" :class="`s-tile--${s.tone}`">
            <span class="s-tile__v">{{ s.v }}</span>
            <span class="s-tile__k">{{ s.k }}</span>
          </div>
        </div>

        <section v-if="stats.byCountry.length" class="flex flex-col gap-2.5">
          <h2 class="fy-section-label" style="margin: 0">{{ t('proof.byCountry') }}</h2>
          <div v-for="c in stats.byCountry" :key="c.country" class="s-country">
            <span style="font-size: 24px" aria-hidden="true">{{ flagOf(c.country) }}</span>
            <span class="flex-1 flex flex-col gap-1.5" style="min-width: 0">
              <span class="flex justify-between gap-2">
                <strong>{{ FONBNK_COUNTRIES[c.country].name }}</strong>
                <span class="fy-caption">{{
                  t('proof.countryLine', { n: c.cashouts, amount: usd(c.volumeUnits) })
                }}</span>
              </span>
              <span class="s-bar"
                ><span :style="{ width: `${(c.cashouts / maxCountry) * 100}%` }"
              /></span>
            </span>
          </div>
        </section>

        <section class="flex flex-col">
          <h2 class="fy-section-label" style="margin: 0 0 4px">{{ t('proof.latest') }}</h2>
          <a
            v-for="p in stats.latest"
            :key="p.link"
            class="fy-list-row"
            :href="p.link"
            target="_blank"
            rel="noopener"
          >
            <span class="s-flag" aria-hidden="true">{{ flagOf(p.country) }}</span>
            <span class="fy-list-row__main">
              <span class="fy-list-row__name">{{ channelLabel(t, te, p.country, p.channel) }}</span>
              <span class="fy-list-row__meta"
                >{{ FONBNK_COUNTRIES[p.country].name }} · {{ shortTimeDisplay(p.at) }}</span
              >
            </span>
            <span class="fy-list-row__end">
              <span>{{ usdtDisplay(BigInt(p.amountUnits)) }} USDT</span>
              <span
                class="fy-chip"
                :class="p.seconds !== null ? 'fy-chip--success' : 'fy-chip--brand'"
              >
                {{
                  p.seconds !== null
                    ? t('proof.paidIn', { t: durationDisplay(p.seconds * 1000) })
                    : t('proof.sent')
                }}
              </span>
            </span>
          </a>
          <p v-if="!stats.latest.length" class="fy-caption" style="margin: 8px 0 0">
            {{ t('proof.empty') }}
          </p>
        </section>

        <section class="fy-panel s-how">
          <h2 style="font: 700 16px var(--fy-font-body); margin: 0">{{ t('proof.howTitle') }}</h2>
          <p>{{ t('proof.how1') }}</p>
          <p>{{ t('proof.how2') }}</p>
          <p>{{ t('proof.how3') }}</p>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.s-live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: 600 13px var(--fy-font-body);
  color: var(--fy-ink-2);
}
.s-live__dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: var(--fy-success);
  animation: s-pulse 1.6s ease-in-out infinite;
}
@keyframes s-pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .s-live__dot {
    animation: none;
  }
}
.s-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.s-tile {
  border-radius: 20px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--fy-card-ink);
  min-width: 0;
}
.s-tile--cream {
  background: var(--fy-card-cream);
}
.s-tile--mint {
  background: var(--fy-card-mint);
}
.s-tile--tangerine {
  background: var(--fy-card-tangerine);
}
.s-tile__v {
  font: 800 28px/1 var(--fy-font-display);
  letter-spacing: -0.04em;
  white-space: nowrap;
}
.s-tile__k {
  font: 600 13.5px var(--fy-font-body);
}
.s-country {
  display: flex;
  align-items: center;
  gap: 12px;
}
.s-bar {
  display: block;
  height: 8px;
  border-radius: 4px;
  background: var(--fy-surface-2);
  overflow: hidden;
}
.s-bar span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--fy-brand);
}
.s-flag {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  background: var(--fy-surface-2);
}
.s-how {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.s-how p {
  margin: 0;
  font-size: 14px;
  color: var(--fy-ink-2);
}
</style>
