<script setup lang="ts">
defineProps<{
  tone: 'info' | 'success' | 'warn' | 'error'
  text: string
  supportRef?: string
}>()
</script>

<template>
  <p :role="tone === 'error' ? 'alert' : 'status'" class="status" :class="`status-${tone}`">
    <span>{{ text }}</span>
    <span v-if="supportRef" class="status-ref">{{ $t('errors.ref', { ref: supportRef }) }}</span>
  </p>
</template>
