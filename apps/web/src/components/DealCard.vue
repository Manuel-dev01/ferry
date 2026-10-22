<script setup lang="ts">
export type CardColor = 'cobalt' | 'cream' | 'tangerine' | 'mint' | 'surface' | 'warning' | 'danger'

// The "dealt" card: the one thing on screen you're deciding on, tilted and lifted, with a
// second card peeking out behind it.
withDefaults(defineProps<{ color: CardColor; back?: CardColor; minHeight?: number }>(), {
  back: 'surface',
  minHeight: 0,
})
</script>

<template>
  <div class="fy-deal">
    <span class="fy-deal__back" :class="`fy-card--${back}`" aria-hidden="true" />
    <div
      class="fy-deal__card"
      :class="`fy-card--${color}`"
      :style="minHeight ? { minHeight: `${minHeight}px` } : undefined"
    >
      <slot />
    </div>
  </div>
</template>
