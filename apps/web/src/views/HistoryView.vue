<script setup lang="ts">
import { isOfframpStatus, isTerminal } from '@ferry/shared'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../components/AppHeader.vue'
import Monogram from '../components/Monogram.vue'
import StatusChip from '../components/StatusChip.vue'
import { shortTimeDisplay } from '../lib/format'
import { useCashoutStore } from '../stores/cashout'
import {
  useHistoryStore,
  type HistoryEntry,
  entryAmount,
  entryAmountMuted,
  entryLink,
  entryTitle,
} from '../stores/history'
import { useSessionStore } from '../stores/session'

const { t, te } = useI18n()
const router = useRouter()
const history = useHistoryStore()
const draft = useCashoutStore()
const session = useSessionStore()

const filter = ref<'all' | 'progress' | 'refunded'>('all')
const filtered = computed(() =>
  history.entries.filter((e) =>
    filter.value === 'all'
      ? true
      : filter.value === 'refunded'
        ? e.status === 'refunded' || e.status === 'failed'
        : !isFinished(e.status),
  ),
)

/** Partner flows end in their own statuses: received (top-up, NIM swap) or failed. */
const PARTNER_FINAL = new Set(['received', 'settled', 'failed', 'expired'])
const isFinished = (status: string) =>
  PARTNER_FINAL.has(status) || (isOfframpStatus(status) && isTerminal(status))

const DAY = 86_400_000
function bucket(at: number): 'today' | 'thisWeek' | 'earlier' {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (at >= start.getTime()) return 'today'
  return at >= start.getTime() - 6 * DAY ? 'thisWeek' : 'earlier'
}
const groups = computed(() => {
  const out: { key: string; rows: HistoryEntry[] }[] = []
  for (const e of filtered.value) {
    const key = bucket(e.createdAt)
    const g = out.find((x) => x.key === key)
    if (g) g.rows.push(e)
    else out.push({ key, rows: [e] })
  }
  return out
})
const meta = (e: HistoryEntry) => {
  const today = bucket(e.createdAt) === 'today'
  const when = today
    ? shortTimeDisplay(e.createdAt)
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(e.createdAt)
  return `${e.institutionName} · ${when}`
}

function cashOut() {
  draft.start('self', session.host.fiat)
  void router.push('/cashout')
}
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/" :title="t('history.title')" />

    <div v-if="!session.evmAddress" class="fy-content items-center justify-center text-center">
      <p class="fy-lede">{{ t('history.connectPrivacy') }}</p>
      <RouterLink to="/" class="fy-btn fy-btn--primary">{{ t('home.connect') }}</RouterLink>
    </div>

    <div
      v-else-if="!history.entries.length"
      class="fy-content items-center justify-center text-center"
      style="padding-bottom: 60px"
    >
      <div class="fy-stack-art" aria-hidden="true">
        <span style="top: 22px; background: var(--fy-card-mint); transform: rotate(-10deg)" />
        <span style="top: 18px; background: var(--fy-card-tangerine); transform: rotate(-2deg)" />
        <span
          style="
            top: 14px;
            background: var(--fy-surface);
            box-shadow:
              inset 0 0 0 1.5px var(--fy-line),
              var(--fy-shadow-2);
            transform: rotate(6deg);
          "
        />
      </div>
      <h1 class="fy-display" style="font-size: 26px">{{ t('history.emptyTitle') }}</h1>
      <p class="fy-lede" style="max-width: 270px">{{ t('history.emptyBody') }}</p>
    </div>

    <div v-else class="fy-content" style="padding-top: 4px; gap: 14px">
      <div class="fy-filters" role="group">
        <button
          type="button"
          class="fy-filter"
          :aria-pressed="filter === 'all'"
          @click="filter = 'all'"
        >
          {{ t('history.all') }}
        </button>
        <button
          type="button"
          class="fy-filter"
          :aria-pressed="filter === 'progress'"
          @click="filter = 'progress'"
        >
          {{ t('history.inProgress') }}
        </button>
        <button
          type="button"
          class="fy-filter"
          :aria-pressed="filter === 'refunded'"
          @click="filter = 'refunded'"
        >
          {{ t('history.refunded') }}
        </button>
      </div>
      <p v-if="!groups.length" class="fy-lede text-center" style="padding-top: 24px">
        {{ t('history.emptyFiltered') }}
      </p>
      <section v-for="g in groups" :key="g.key" class="fy-list">
        <h2 class="fy-section-label" style="margin: 0">{{ t(`history.${g.key}`) }}</h2>
        <RouterLink v-for="e in g.rows" :key="e.id" :to="entryLink(e)" class="fy-list-row">
          <Monogram :name="e.institutionName" />
          <span class="fy-list-row__main">
            <span class="fy-list-row__name">{{ entryTitle(e, t, te) }}</span>
            <span class="fy-list-row__meta">{{ meta(e) }}</span>
          </span>
          <span class="fy-list-row__end">
            <span :class="{ 'fy-history-amount--muted': entryAmountMuted(e) }">{{
              entryAmount(e)
            }}</span>
            <StatusChip :status="e.status" />
          </span>
        </RouterLink>
      </section>
    </div>

    <div v-if="session.evmAddress && !history.entries.length" class="fy-bottom">
      <button type="button" class="fy-btn fy-btn--primary" @click="cashOut">
        {{ t('history.cashOut') }}
      </button>
    </div>
  </main>
</template>
