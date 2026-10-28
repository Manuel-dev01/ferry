<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

// Fonbnk's "Back to Ferry" link lands here. Inside Ferry's embedded Fonbnk frame it tells the
// page around it to move on; opened on its own it just goes home.
const { t } = useI18n()
const router = useRouter()

onMounted(() => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'ferry:fonbnk-return' }, window.location.origin)
  } else {
    void router.replace('/')
  }
})
</script>

<template>
  <main class="fy-screen" style="align-items: center; justify-content: center">
    <p class="fy-caption">{{ t('fonbnk.returning') }}</p>
  </main>
</template>
