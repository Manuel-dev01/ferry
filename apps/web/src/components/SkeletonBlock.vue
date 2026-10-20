<script setup lang="ts">
withDefaults(defineProps<{ lines?: number }>(), { lines: 3 })
</script>

<template>
  <div class="card" aria-busy="true" aria-live="polite">
    <div v-for="i in lines" :key="i" class="skeleton" :style="{ width: `${90 - i * 15}%` }" />
  </div>
</template>
