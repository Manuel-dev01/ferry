<script setup lang="ts">
withDefaults(defineProps<{ onBrand?: boolean; mark?: boolean }>(), { onBrand: false, mark: true })
</script>

<template>
  <span class="fy-logo" :class="{ 'fy-logo--on-brand': onBrand }">
    <span v-if="mark" class="fy-logo__mark" aria-hidden="true"><span /><span /></span>
    <span class="fy-logo__word">ferry</span>
  </span>
</template>
