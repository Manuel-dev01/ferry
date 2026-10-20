<script setup lang="ts">
import { monogram } from '@ferry/shared'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: 'sm' | 'md' }>(), { size: 'md' })

// Stable tint per name. We never show third-party logos.
const TINTS = [
  'bg-blue-400 text-blue-1100',
  'bg-green-400 text-green-1100',
  'bg-gold-400 text-gold-1100',
  'bg-neutral-300 text-neutral-1100',
]
const tint = computed(() => {
  let h = 0
  for (const ch of props.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
})
</script>

<template>
  <span
    class="monogram"
    :class="[tint, size === 'sm' ? 'size-8 text-xs' : 'size-11 text-sm']"
    aria-hidden="true"
  >
    {{ monogram(name) }}
  </span>
</template>
