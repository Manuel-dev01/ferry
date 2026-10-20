<script setup lang="ts">
import { onMounted } from 'vue'
import { useSessionStore } from './stores/session'

const session = useSessionStore()
onMounted(() => void session.start())
</script>

<template>
  <RouterView />
</template>
