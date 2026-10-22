<script setup lang="ts">
import Banner from './Banner.vue'

// Simple tone-based message, used by the Phase 0 spike screens.
defineProps<{ tone: 'info' | 'success' | 'warn' | 'error'; text: string; supportRef?: string }>()
const TONES = { info: 'neutral', success: 'success', warn: 'warning', error: 'danger' } as const
</script>

<template>
  <Banner :tone="TONES[tone]" :body="text" :support-ref="supportRef" style="margin-bottom: 12px" />
</template>
