<script setup lang="ts">
import Icon, { type IconName } from './Icon.vue'

export type BannerTone = 'success' | 'brand' | 'warning' | 'danger' | 'neutral'

const ICONS: Record<BannerTone, IconName> = {
  success: 'shield',
  brand: 'info',
  warning: 'clock',
  danger: 'alert',
  neutral: 'info',
}

const props = defineProps<{
  tone: BannerTone
  title?: string
  body?: string
  supportRef?: string
  action?: string
  icon?: IconName
}>()
defineEmits<{ action: [] }>()
</script>

<template>
  <div
    class="fy-banner"
    :class="`fy-banner--${tone}`"
    :role="tone === 'danger' ? 'alert' : 'status'"
  >
    <Icon class="fy-banner__icon" :name="props.icon ?? ICONS[tone]" />
    <span class="fy-banner__text">
      <span v-if="title" class="fy-banner__title">{{ title }}</span>
      <span v-if="body" :class="title ? 'fy-banner__body' : ''">{{ body }}</span>
      <slot />
      <span v-if="supportRef" class="fy-banner__ref">{{
        $t('errors.ref', { ref: supportRef })
      }}</span>
      <button v-if="action" type="button" class="fy-banner__action" @click="$emit('action')">
        {{ action }}
      </button>
    </span>
  </div>
</template>
