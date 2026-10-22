<script setup lang="ts">
import AppHeader from './AppHeader.vue'
import DealCard, { type CardColor } from './DealCard.vue'
import FerryLogo from './FerryLogo.vue'
import NimiqMark from './NimiqMark.vue'

// A full-screen moment built around one dealt card: signing, outcomes and system states.
defineProps<{
  color: CardColor
  eyebrow: string
  title: string
  sub?: string
  heading: string
  body: string
  rows?: { k: string; v: string }[]
  primary?: string
  primaryNimiq?: boolean
  primaryHref?: string
  secondary?: string
  close?: string
  busy?: boolean
}>()
defineEmits<{ primary: []; secondary: [] }>()
</script>

<template>
  <main class="fy-screen">
    <AppHeader :close="close ?? '/'">
      <FerryLogo :mark="false" />
    </AppHeader>
    <div class="fy-content" style="padding-top: 20px; gap: 24px">
      <DealCard :color="color" :min-height="200">
        <span class="fy-eyebrow">{{ eyebrow }}</span>
        <span class="fy-card-title">{{ title }}</span>
        <span v-if="sub" class="fy-card-sub">{{ sub }}</span>
      </DealCard>
      <div class="flex flex-col gap-2">
        <h1 class="fy-title">{{ heading }}</h1>
        <p class="fy-lede">{{ body }}</p>
      </div>
      <dl v-if="rows?.length" class="fy-panel">
        <div v-for="r in rows" :key="r.k" class="fy-row">
          <dt class="fy-row__k">{{ r.k }}</dt>
          <dd class="fy-row__v font-semibold">{{ r.v }}</dd>
        </div>
      </dl>
      <slot />
    </div>
    <div v-if="primary || secondary" class="fy-bottom">
      <template v-if="primary">
        <a
          v-if="primaryHref"
          :href="primaryHref"
          class="fy-btn"
          :class="primaryNimiq ? 'fy-btn--ink' : 'fy-btn--primary'"
        >
          <span v-if="primaryNimiq" class="fy-btn__mark"><NimiqMark /></span>{{ primary }}
        </a>
        <button
          v-else
          type="button"
          class="fy-btn"
          :class="[primaryNimiq ? 'fy-btn--ink' : 'fy-btn--primary', busy && 'fy-btn--busy']"
          :disabled="busy"
          @click="$emit('primary')"
        >
          <span v-if="primaryNimiq" class="fy-btn__mark"><NimiqMark /></span>{{ primary }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
      </template>
      <button
        v-if="secondary"
        type="button"
        class="fy-btn fy-btn--text"
        @click="$emit('secondary')"
      >
        {{ secondary }}
      </button>
    </div>
  </main>
</template>
