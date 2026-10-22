<script setup lang="ts">
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{ back?: string | false; close?: string; title?: string }>(),
  { back: undefined, close: undefined, title: undefined },
)
const router = useRouter()

function goBack() {
  if (typeof props.back === 'string') void router.push(props.back)
  else if (window.history.length > 1) router.back()
  else void router.push('/')
}
</script>

<template>
  <header class="fy-header">
    <RouterLink v-if="close" :to="close" class="fy-iconbtn" :aria-label="$t('common.close')">
      <Icon name="close" />
    </RouterLink>
    <button
      v-else-if="back !== false"
      type="button"
      class="fy-iconbtn"
      :aria-label="$t('common.back')"
      @click="goBack"
    >
      <Icon name="back" :size="22" />
    </button>
    <span v-else class="fy-header__spacer" />

    <span class="fy-header__center">
      <slot>
        <span v-if="title" class="fy-header__title">{{ title }}</span>
      </slot>
    </span>

    <slot name="end"><span class="fy-header__spacer" /></slot>
  </header>
</template>
