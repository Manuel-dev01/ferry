<script setup lang="ts">
import type { LogEntry } from '../composables/useStepLog'

defineProps<{ entries: LogEntry[] }>()
</script>

<template>
  <ol v-if="entries.length" class="steplog" aria-live="polite">
    <li v-for="(e, i) in entries" :key="i" :class="`steplog-${e.tone}`">
      <span class="steplog-at">{{ e.at }}</span>
      <span>{{ e.text }}</span>
    </li>
  </ol>
</template>
