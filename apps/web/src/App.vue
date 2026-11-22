<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import { MOCK_WALLET } from './config'
import { useHistoryStore } from './stores/history'
import { useSessionStore } from './stores/session'
import { createNimTracker } from './lib/nimTracking'
import { ferryApi } from './lib/ferryApi'

const MockWalletSheet =
  import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true'
    ? defineAsyncComponent(() => import('./dev/MockWalletSheet.vue'))
    : null

const session = useSessionStore()
const history = useHistoryStore()
// Lazy-load the swap SDK only when this device has an unfinished NIM swap.
const tracker = createNimTracker({
  entries: () => history.entries,
  read: async (id) => (await import('./lib/nimSwap')).nimSwapState(id),
  claim: async (id) => (await import('./lib/nimSwap')).claimNimSwap(id),
  status: (id, status) => history.setStatus(id, status),
  report: (id) => ferryApi.recordNimSwap(id),
})
const reconcileNim = () => {
  void tracker.tick()
}
const resumeNim = () => {
  if (!document.hidden) reconcileNim()
}
let nimTimer: ReturnType<typeof setInterval> | undefined
watch(() => history.entries.map((e) => `${e.id}:${e.status}`).join(','), reconcileNim)
onMounted(() => {
  void session.start()
  void history.syncConfirmations() // confirmations that didn't reach Ferry's server yet
  reconcileNim()
  nimTimer = setInterval(reconcileNim, 4_000)
  document.addEventListener('visibilitychange', resumeNim)
  window.addEventListener('pageshow', reconcileNim)
  window.addEventListener('online', reconcileNim)
})
onUnmounted(() => {
  tracker.stop()
  clearInterval(nimTimer)
  document.removeEventListener('visibilitychange', resumeNim)
  window.removeEventListener('pageshow', reconcileNim)
  window.removeEventListener('online', reconcileNim)
})
</script>

<template>
  <p v-if="MOCK_WALLET" class="mock-badge">{{ $t('common.mockBadge') }}</p>
  <RouterView />
  <component :is="MockWalletSheet" v-if="MockWalletSheet" />
</template>
