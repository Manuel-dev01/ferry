<script setup lang="ts">
import { useRouter } from 'vue-router'

const props = defineProps<{ title: string; step?: number; steps?: number; back?: string | false }>()
const router = useRouter()

function goBack() {
  if (typeof props.back === 'string') void router.push(props.back)
  else if (window.history.length > 1) router.back()
  else void router.push('/')
}
</script>

<template>
  <header class="topbar">
    <button
      v-if="back !== false"
      type="button"
      class="icon-btn"
      :aria-label="$t('common.back')"
      @click="goBack"
    >
      <span class="i-nimiq:arrow-left text-lg" aria-hidden="true" />
    </button>
    <div class="flex-1 min-w-0">
      <p v-if="step && steps" class="text-xs text-neutral-700 font-semibold">
        {{ $t('common.step', { step, steps }) }}
      </p>
      <h1 class="text-xl font-bold truncate">{{ title }}</h1>
    </div>
  </header>
  <div
    v-if="step && steps"
    class="progress"
    role="progressbar"
    :aria-valuenow="step"
    :aria-valuemin="1"
    :aria-valuemax="steps"
  >
    <div class="progress-fill" :style="{ width: `${(step / steps) * 100}%` }" />
  </div>
</template>
