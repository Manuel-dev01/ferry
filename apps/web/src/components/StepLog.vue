<script setup lang="ts">
import type { LogEntry } from '../composables/useStepLog'

defineProps<{ entries: LogEntry[] }>()
</script>

<template>
  <details v-if="entries.length" class="steplog-box">
    <summary>Technical log · {{ entries.length }}</summary>
    <ol class="steplog">
      <li v-for="(e, i) in entries" :key="i" :class="`steplog-${e.tone}`">
        <span class="steplog-at">{{ e.at }}</span>
        <span>{{ e.text }}</span>
      </li>
    </ol>
  </details>
</template>

<style scoped>
.steplog-box {
  border-radius: var(--fy-radius-m);
  box-shadow: inset 0 0 0 1px var(--fy-line);
  padding: 0 14px;
}
.steplog-box summary {
  min-height: 48px;
  display: flex;
  align-items: center;
  font: 600 14px var(--fy-font-body);
  color: var(--fy-ink-2);
  cursor: pointer;
}
.steplog-box[open] {
  padding-bottom: 12px;
}
.steplog {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.steplog-at {
  margin-right: 8px;
  color: var(--fy-ink-3);
  font-variant-numeric: tabular-nums;
}
.steplog-success {
  color: var(--fy-success);
}
.steplog-warn {
  color: var(--fy-warning);
}
.steplog-error {
  color: var(--fy-danger);
}
</style>
