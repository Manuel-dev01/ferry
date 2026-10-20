<script setup lang="ts">
import type { Institution } from '@ferry/shared'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Monogram from '../../components/Monogram.vue'
import SkeletonBlock from '../../components/SkeletonBlock.vue'
import StatusMessage from '../../components/StatusMessage.vue'
import TopBar from '../../components/TopBar.vue'
import { errorRef } from '../../lib/api'
import { ferryApi } from '../../lib/ferryApi'
import { useCashoutStore } from '../../stores/cashout'

const RECENT_KEY = 'ferry.recentInstitutions.v1'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()

const list = ref<Institution[] | null>(null)
const failed = ref<{ ref?: string } | null>(null)
const query = ref('')
const type = ref<'all' | 'bank' | 'mobile_money'>('all')

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

async function load() {
  failed.value = null
  list.value = null
  try {
    list.value = await ferryApi.institutions(draft.currency!)
  } catch (err) {
    failed.value = { ref: errorRef(err) }
  }
}
onMounted(load)

const hasBothTypes = computed(() => !!list.value && new Set(list.value.map((i) => i.type)).size > 1)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (list.value ?? []).filter(
    (i) =>
      (type.value === 'all' || i.type === type.value) &&
      (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)),
  )
})

const recent = computed(() => {
  if (query.value || !list.value) return []
  const codes = readRecent()
  return codes
    .map((code) => list.value!.find((i) => i.code === code))
    .filter((i): i is Institution => !!i)
    .slice(0, 3)
})

function choose(i: Institution) {
  try {
    const codes = [i.code, ...readRecent().filter((c) => c !== i.code)].slice(0, 10)
    localStorage.setItem(RECENT_KEY, JSON.stringify(codes))
  } catch {
    // no storage: recents just won't persist
  }
  draft.setInstitution(i)
  void router.push('/cashout/account')
}
</script>

<template>
  <main class="page">
    <TopBar :title="t('institution.title')" :step="2" :steps="5" back="/cashout" />

    <label class="sr-only" for="institution-search">{{ t('institution.search') }}</label>
    <input
      id="institution-search"
      v-model="query"
      class="input mb-3"
      type="search"
      autocomplete="off"
      :placeholder="t('institution.search')"
    />

    <div v-if="hasBothTypes" class="flex gap-2 mb-3" role="group">
      <button
        v-for="opt in ['all', 'bank', 'mobile_money'] as const"
        :key="opt"
        type="button"
        class="chip"
        :class="{ 'chip-active': type === opt }"
        :aria-pressed="type === opt"
        @click="type = opt"
      >
        {{
          opt === 'all'
            ? t('institution.all')
            : opt === 'bank'
              ? t('institution.banks')
              : t('institution.mobile')
        }}
      </button>
    </div>

    <template v-if="failed">
      <StatusMessage tone="error" :text="t('institution.loadFailed')" :support-ref="failed.ref" />
      <button type="button" class="btn-secondary" @click="load">{{ t('common.tryAgain') }}</button>
    </template>

    <template v-else-if="!list">
      <SkeletonBlock :lines="4" />
    </template>

    <template v-else>
      <template v-if="recent.length">
        <h2 class="section-label">{{ t('institution.recent') }}</h2>
        <ul class="list mb-4" role="list">
          <li v-for="i in recent" :key="`r-${i.code}`">
            <button type="button" class="list-item" @click="choose(i)">
              <Monogram :name="i.name" />
              <span class="flex-1 text-left font-semibold">{{ i.name }}</span>
            </button>
          </li>
        </ul>
        <h2 class="section-label">{{ t('institution.all') }}</h2>
      </template>

      <p v-if="!filtered.length" class="muted text-center py-6">{{ t('institution.empty') }}</p>
      <ul v-else class="list" role="list">
        <li v-for="i in filtered" :key="i.code">
          <button type="button" class="list-item" @click="choose(i)">
            <Monogram :name="i.name" />
            <span class="flex-1 text-left">
              <span class="block font-semibold">{{ i.name }}</span>
              <span class="block text-xs text-neutral-700">
                {{ i.type === 'bank' ? t('institution.banks') : t('institution.mobile') }}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </main>
</template>
