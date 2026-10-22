<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import DealCard from '../../components/DealCard.vue'
import Icon from '../../components/Icon.vue'
import { monogram } from '@ferry/shared'
import { useCashoutStore } from '../../stores/cashout'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const institution = computed(() => draft.institution!)
/** Longest word, so the name can shrink to fit the card instead of breaking mid-word. */
const longestWord = computed(() =>
  Math.max(...(draft.accountName ?? '').split(/\s+/).map((w) => w.length), 4),
)

function no() {
  draft.accountName = null
  void router.push('/cashout/account')
}
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/cashout/account">{{ t('common.step', { step: 3, steps: 4 }) }}</AppHeader>
    <div class="fy-content" style="padding-top: 16px; gap: 26px">
      <h1 class="fy-display">{{ t('confirm.title') }}</h1>

      <DealCard color="tangerine" back="cream" :min-height="236">
        <div class="flex items-center justify-between">
          <span class="fy-eyebrow">{{ t('confirm.eyebrow') }}</span>
          <span
            class="inline-flex items-center justify-center"
            style="
              width: 32px;
              height: 32px;
              border-radius: 16px;
              background: var(--fy-card-ink);
              color: var(--fy-card-tangerine);
            "
          >
            <Icon name="check" :size="16" :stroke="3" />
          </span>
        </div>
        <div class="fy-fit" :style="{ '--n': longestWord }">
          <span class="fy-fit__name" aria-live="polite">{{ draft.accountName }}</span>
        </div>
        <div class="flex items-center gap-2.5">
          <span
            class="fy-mono fy-mono--sm"
            style="background: var(--fy-card-ink); color: var(--fy-card-cream)"
            >{{ monogram(institution.name) }}</span
          >
          <span style="font: 600 16px var(--fy-font-body)"
            >{{ institution.name }} · {{ draft.accountMasked }}</span
          >
        </div>
      </DealCard>

      <div
        class="flex flex-col gap-3"
        style="font-size: 14.5px; line-height: 1.45; color: var(--fy-ink-2)"
      >
        <span class="fy-note"
          ><Icon name="check" :size="18" :stroke="2.2" />{{
            t('confirm.from', { institution: institution.name })
          }}</span
        >
        <span class="fy-note"
          ><Icon name="shield" :size="18" />{{ t('confirm.nothingMoves') }}</span
        >
      </div>
    </div>

    <div class="fy-bottom">
      <button type="button" class="fy-btn fy-btn--primary" @click="router.push('/cashout/amount')">
        {{ t('confirm.yes') }}
      </button>
      <button
        type="button"
        class="fy-btn fy-btn--secondary"
        style="min-height: 52px; font-size: 16px"
        @click="no"
      >
        {{ t('confirm.no') }}
      </button>
    </div>
  </main>
</template>
