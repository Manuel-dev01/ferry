<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import Banner from './Banner.vue'
const props = defineProps<{ body: string }>()
const target = ref<HTMLElement | null>(null)
async function reveal() {
  await nextTick()
  target.value?.focus({ preventScroll: true })
  target.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
onMounted(reveal)
watch(() => props.body, reveal)
</script>
<template>
  <div ref="target" class="payment-error" tabindex="-1">
    <Banner tone="danger" :body="body" />
  </div>
</template>
<style scoped>
.payment-error {
  max-height: 40svh;
  overflow: auto;
  scroll-margin-block: 16px;
}
</style>
