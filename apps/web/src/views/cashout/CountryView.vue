<script setup lang="ts">
import { CORRIDORS, type CorridorCurrency } from '@ferry/shared'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import TopBar from '../../components/TopBar.vue'
import { useCashoutStore } from '../../stores/cashout'
import { useSessionStore } from '../../stores/session'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()

const FLAGS: Record<CorridorCurrency, string> = { NGN: '🇳🇬', KES: '🇰🇪', UGX: '🇺🇬', TZS: '🇹🇿' }

const corridors = computed(() =>
  CORRIDORS.map((c) => ({
    ...c,
    enabled: session.meta?.corridors.find((m) => m.currency === c.currency)?.enabled ?? true,
  })),
)

function choose(currency: CorridorCurrency) {
  draft.setCurrency(currency)
  void router.push('/cashout/bank')
}
</script>

<template>
  <main class="page">
    <TopBar
      :title="draft.recipientKind === 'other' ? t('country.titleOther') : t('country.title')"
      :step="1"
      :steps="5"
      back="/"
    />
    <ul class="flex flex-col gap-3" role="list">
      <li v-for="c in corridors" :key="c.currency">
        <button
          type="button"
          class="tile w-full"
          :class="{ 'ring-2 ring-blue': draft.currency === c.currency }"
          :disabled="!c.enabled"
          @click="choose(c.currency)"
        >
          <span class="text-3xl" aria-hidden="true">{{ FLAGS[c.currency] }}</span>
          <span class="flex-1 text-left">
            <span class="block font-bold">{{ c.name }}</span>
            <span class="block text-sm text-neutral-800">
              {{ c.enabled ? t(`country.methods.${c.currency}`) : t('country.paused') }}
            </span>
          </span>
          <span class="i-nimiq:chevron-right text-neutral-700" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </main>
</template>
