<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Monogram from '../components/Monogram.vue'
import TopBar from '../components/TopBar.vue'
import { fiatDisplay } from '../lib/format'
import { useHistoryStore } from '../stores/history'

const { t, te } = useI18n()
const history = useHistoryStore()

const statusText = (s: string) => (te(`history.status.${s}`) ? t(`history.status.${s}`) : s)
const statusTone = (s: string) =>
  s === 'settled'
    ? 'text-green-1100'
    : ['refunded', 'expired', 'failed'].includes(s)
      ? 'text-neutral-800'
      : 'text-blue'
const dateText = (at: number) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(at)
</script>

<template>
  <main class="page">
    <TopBar :title="t('history.title')" back="/" />
    <p v-if="!history.entries.length" class="card muted text-center py-8">
      {{ t('history.empty') }}
    </p>
    <ul v-else class="list" role="list">
      <li v-for="e in history.entries" :key="e.id">
        <RouterLink :to="`/orders/${e.id}`" class="list-item">
          <Monogram :name="e.institutionName" />
          <span class="flex-1 min-w-0">
            <span class="block font-semibold truncate">
              {{ e.recipientName ?? t('history.cashOut') }} · {{ e.institutionName }}
            </span>
            <span class="block text-xs text-neutral-700">{{ dateText(e.createdAt) }}</span>
          </span>
          <span class="text-right">
            <span class="block font-bold">{{ fiatDisplay(e.theyReceiveMinor, e.currency) }}</span>
            <span class="block text-xs font-semibold" :class="statusTone(e.status)">{{
              statusText(e.status)
            }}</span>
          </span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>
