<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import BottomAction from '../../components/BottomAction.vue'
import Monogram from '../../components/Monogram.vue'
import TopBar from '../../components/TopBar.vue'
import { useCashoutStore } from '../../stores/cashout'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()

function no() {
  draft.accountName = null
  void router.push('/cashout/account')
}
</script>

<template>
  <main class="page">
    <TopBar :title="t('confirm.title')" :step="3" :steps="5" back="/cashout/account" />

    <section class="card text-center py-8" aria-live="polite">
      <div class="flex justify-center mb-3"><Monogram :name="draft.accountName!" /></div>
      <p class="text-2xl font-bold">{{ draft.accountName }}</p>
      <p class="text-neutral-800 mt-1">
        {{ draft.institution!.name }} · <span class="font-mono">{{ draft.accountMasked }}</span>
      </p>
      <p class="inline-flex items-center gap-1 text-sm text-green-1100 mt-3">
        <span class="i-nimiq:check" aria-hidden="true" /> {{ t('confirm.verified') }}
      </p>
    </section>
    <p class="muted text-sm px-1">{{ t('confirm.body') }}</p>

    <BottomAction>
      <button type="button" class="btn-primary" @click="router.push('/cashout/amount')">
        {{ t('confirm.yes') }}
      </button>
      <button type="button" class="btn-ghost" @click="no">{{ t('confirm.no') }}</button>
    </BottomAction>
  </main>
</template>
