<script setup lang="ts">
import { monogram } from '@ferry/shared'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ name: string; seed?: string; size?: 'md' | 'sm' | 'xs' }>(),
  { size: 'md', seed: undefined },
)

// Two letters, tint from a stable hash of the institution. Never a third-party logo.
const TINTS = ['ink', 'tangerine', 'mint', 'cream', 'cobalt'] as const
const tint = computed(() => {
  let h = 0
  for (const ch of props.seed ?? props.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
})
</script>

<template>
  <span
    class="fy-mono"
    :class="[`fy-mono--${tint}`, size !== 'md' && `fy-mono--${size}`]"
    aria-hidden="true"
    >{{ monogram(name) }}</span
  >
</template>
