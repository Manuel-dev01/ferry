import { defineConfig, presetWind4 } from 'unocss'

// Layout utilities only (flex, gap, spacing). Colours, type and components live in
// src/styles as var(--fy-*) tokens from the Ferry "Deal" design system.
export default defineConfig({
  presets: [presetWind4({ preflights: { reset: false } })],
})
