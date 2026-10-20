<script setup lang="ts">
import { defineAsyncComponent, onMounted } from 'vue'
import { MOCK_WALLET } from './config'
import { useSessionStore } from './stores/session'

const MockWalletSheet =
  import.meta.env.DEV && import.meta.env.VITE_MOCK_WALLET === 'true'
    ? defineAsyncComponent(() => import('./dev/MockWalletSheet.vue'))
    : null

const session = useSessionStore()
onMounted(() => void session.start())
</script>

<template>
  <p v-if="MOCK_WALLET" class="mock-badge">{{ $t('common.mockBadge') }}</p>
  <RouterView />
  <component :is="MockWalletSheet" v-if="MockWalletSheet" />
</template>
