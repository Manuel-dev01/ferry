<script setup lang="ts">
// The Nimiq hexagon, from Nimiq's official icon set (nimiq-icons, MIT). Used only on
// "Open in Nimiq Pay" buttons, as the design system requires.
withDefaults(defineProps<{ size?: number }>(), { size: 20 })
</script>

<template>
  <svg
    :width="size"
    :height="(size * 18) / 20"
    viewBox="0 0 20 18"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <radialGradient
        id="fy-nimiq-hex"
        cx="0"
        cy="0"
        r="1"
        gradientTransform="matrix(-19.9562 0 0 -18 19.956 18)"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="#EC991C" />
        <stop offset="1" stop-color="#E9B213" />
      </radialGradient>
    </defs>
    <path
      fill="url(#fy-nimiq-hex)"
      d="M19.734 8.156 15.576.844A1.66 1.66 0 0014.135 0H5.819C5.226 0 4.677.32 4.38.844L.222 8.156a1.71 1.71 0 000 1.688l4.158 7.312c.297.523.846.844 1.439.844h8.316c.593 0 1.142-.32 1.438-.844l4.158-7.312c.3-.523.3-1.165.003-1.688"
    />
  </svg>
</template>
