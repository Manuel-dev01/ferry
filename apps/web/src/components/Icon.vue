<script setup lang="ts">
// Ferry's icon set: 24 px grid, 2 px stroke, round caps and joins, currentColor.
const PATHS = {
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
  'arrow-right': 'M4 12h15M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  swap: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  alert: 'M12 4L2.5 20h19zM12 10v4M12 17v.5',
  refund: 'M4 9h11a5 5 0 0 1 0 10H9M8 5L4 9l4 4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7l13-3v3M16 13.5h2',
  offline:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.5M19 13a10 10 0 0 0-3-2.2M2 9.5a15 15 0 0 1 5-3M22 9.5A15 15 0 0 0 11 5.5M12 20v.5',
  bank: 'M3 9l9-5 9 5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  settings:
    'M10.43 5.18L10.68 2.59L13.32 2.59L13.57 5.18A7 7 0 0 1 15.71 6.06L17.72 4.41L19.59 6.28L17.94 8.29A7 7 0 0 1 18.82 10.43L21.41 10.68L21.41 13.32L18.82 13.57A7 7 0 0 1 17.94 15.71L19.59 17.72L17.72 19.59L15.71 17.94A7 7 0 0 1 13.57 18.82L13.32 21.41L10.68 21.41L10.43 18.82A7 7 0 0 1 8.29 17.94L6.28 19.59L4.41 17.72L6.06 15.71A7 7 0 0 1 5.18 13.57L2.59 13.32L2.59 10.68L5.18 10.43A7 7 0 0 1 6.06 8.29L4.41 6.28L6.28 4.41L8.29 6.06A7 7 0 0 1 10.43 5.18ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
} as const

export type IconName = keyof typeof PATHS

withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), {
  size: 20,
  stroke: 2,
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
