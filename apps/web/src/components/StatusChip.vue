<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'

const props = defineProps<{ status: string; large?: boolean }>()
const { t, te } = useI18n()

const tone = computed(() => {
  switch (props.status) {
    case 'settled':
      return 'success'
    case 'compliance_hold':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'refunded':
    case 'expired':
      return 'neutral'
    default:
      return 'brand'
  }
})
const label = computed(() =>
  te(`history.status.${props.status}`) ? t(`history.status.${props.status}`) : props.status,
)
</script>

<template>
  <span class="fy-chip" :class="[`fy-chip--${tone}`, large && 'fy-chip--lg']">
    <Icon v-if="status === 'settled'" name="check" :size="12" :stroke="3" />
    {{ label }}
  </span>
</template>
