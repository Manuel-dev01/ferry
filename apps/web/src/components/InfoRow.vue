<script setup lang="ts">
defineProps<{ label: string; value: string; mono?: boolean }>()
</script>

<template>
  <div class="row">
    <dt class="row-label">{{ label }}</dt>
    <dd class="row-value" :class="{ 'font-mono': mono }">{{ value }}</dd>
  </div>
</template>
