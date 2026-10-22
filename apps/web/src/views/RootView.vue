<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useSessionStore } from '../stores/session'
import HomeView from './HomeView.vue'

// Inside Nimiq Pay: the Mini App. In a normal browser: the public landing page.
const LandingView = defineAsyncComponent(() => import('./LandingView.vue'))
const session = useSessionStore()
</script>

<template>
  <LandingView v-if="session.status === 'outside'" />
  <HomeView v-else />
</template>
