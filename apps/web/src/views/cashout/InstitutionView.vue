<script setup lang="ts">
import type { Institution } from '@ferry/shared'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import Monogram from '../../components/Monogram.vue'
import { errorRef } from '../../lib/api'
import { COUNTRY_NAMES, FLAGS } from '../../lib/corridors'
import { ferryApi } from '../../lib/ferryApi'
import { useCashoutStore } from '../../stores/cashout'

const RECENT_KEY = 'ferry.recentInstitutions.v1'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const currency = computed(() => draft.currency!)

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
    list.value = await ferryApi.institutions(currency.value)
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
      (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().startsWith(q)),
  )
})
const recent = computed(() => {
  if (query.value || !list.value) return []
  return readRecent()
    .map((code) => list.value!.find((i) => i.code === code))
    .filter((i): i is Institution => !!i && (type.value === 'all' || i.type === type.value))
    .slice(0, 3)
})
const kindText = (i: Institution) =>
  i.type === 'bank' ? t('institution.bank') : t('institution.mobileMoney')

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
  <main class="fy-screen">
    <AppHeader back="/cashout">
      {{ FLAGS[currency] }} {{ COUNTRY_NAMES[currency] }} ·
      {{ t('common.step', { step: 2, steps: 4 }) }}
    </AppHeader>
    <div class="fy-content" style="gap: 14px">
      <h1 class="fy-title" style="font-size: 24px; line-height: 1.15">
        {{ t('institution.title') }}
      </h1>

      <div class="flex flex-col gap-1.5">
        <label class="fy-label" for="institution-search">{{ t('institution.search') }}</label>
        <div class="fy-search">
          <Icon name="search" style="color: var(--fy-ink-2)" />
          <input
            id="institution-search"
            v-model="query"
            type="search"
            autocomplete="off"
            :placeholder="t('institution.placeholder')"
          />
          <button
            v-if="query"
            type="button"
            class="fy-iconbtn"
            style="width: 40px; height: 40px"
            :aria-label="t('institution.clearSearch')"
            @click="query = ''"
          >
            <span
              class="inline-flex items-center justify-center"
              style="
                width: 28px;
                height: 28px;
                border-radius: 14px;
                background: var(--fy-surface-2);
              "
            >
              <Icon name="close" :size="14" :stroke="2.4" />
            </span>
          </button>
        </div>
      </div>

      <div
        v-if="hasBothTypes"
        class="fy-filters"
        role="group"
        :aria-label="t('institution.filter')"
      >
        <button
          v-for="opt in ['all', 'bank', 'mobile_money'] as const"
          :key="opt"
          type="button"
          class="fy-filter"
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
        <Banner
          tone="danger"
          :body="t('institution.loadFailed')"
          :support-ref="failed.ref"
          :action="t('common.tryAgain')"
          @action="load"
        />
      </template>

      <div v-else-if="!list" class="flex flex-col gap-4 pt-2" aria-busy="true">
        <span class="fy-skel" style="width: 110px; height: 12px" />
        <div v-for="i in 4" :key="i" class="flex items-center gap-3.5">
          <span class="fy-skel" style="width: 44px; height: 44px; border-radius: 12px" />
          <span class="flex-1 flex flex-col gap-2">
            <span
              class="fy-skel fy-skel--shimmer"
              :style="{ width: `${50 - i * 4}%`, height: '14px' }"
            />
            <span class="fy-skel" :style="{ width: `${30 + i * 6}%`, height: '11px' }" />
          </span>
        </div>
      </div>

      <div
        v-else-if="!filtered.length"
        class="flex flex-col items-center text-center gap-3"
        style="padding-top: 36px"
      >
        <div style="position: relative; width: 150px; height: 100px" aria-hidden="true">
          <span
            style="
              position: absolute;
              left: 10px;
              top: 14px;
              width: 130px;
              height: 80px;
              border-radius: 16px;
              background: var(--fy-surface-2);
              transform: rotate(-8deg);
            "
          />
          <span
            style="
              position: absolute;
              left: 10px;
              top: 10px;
              width: 130px;
              height: 80px;
              border-radius: 16px;
              background: var(--fy-surface);
              box-shadow:
                inset 0 0 0 1.5px var(--fy-line),
                var(--fy-shadow-2);
              transform: rotate(4deg);
              display: flex;
              align-items: center;
              justify-content: center;
              font: 800 30px var(--fy-font-display);
              color: var(--fy-ink-3);
            "
            >?</span
          >
        </div>
        <span style="font: 700 19px var(--fy-font-body)">{{
          t('institution.emptyTitle', { query })
        }}</span>
        <span style="font-size: 15px; color: var(--fy-ink-2); max-width: 280px">{{
          t('institution.emptyBody')
        }}</span>
        <button
          v-if="query"
          type="button"
          class="fy-btn fy-btn--secondary fy-btn--sm"
          @click="query = ''"
        >
          {{ t('institution.clearSearch') }}
        </button>
      </div>

      <div v-else class="fy-list">
        <template v-if="recent.length">
          <span class="fy-section-label">{{ t('institution.recent') }}</span>
          <button
            v-for="i in recent"
            :key="`r-${i.code}`"
            type="button"
            class="fy-list-row"
            @click="choose(i)"
          >
            <Monogram :name="i.name" :seed="i.code" />
            <span class="fy-list-row__main">
              <span class="fy-list-row__name">{{ i.name }}</span>
              <span class="fy-list-row__meta"
                >{{ kindText(i) }} · {{ t('institution.recent') }}</span
              >
            </span>
            <Icon name="forward" :size="18" style="color: var(--fy-ink-3)" />
          </button>
          <span class="fy-section-label" style="padding-top: 16px">{{
            t('institution.allCount', { count: filtered.length })
          }}</span>
        </template>
        <button
          v-for="i in filtered"
          :key="i.code"
          type="button"
          class="fy-list-row"
          style="min-height: 60px"
          @click="choose(i)"
        >
          <Monogram :name="i.name" :seed="i.code" />
          <span class="fy-list-row__main">
            <span class="fy-list-row__name">{{ i.name }}</span>
            <span class="fy-list-row__meta">{{ kindText(i) }}</span>
          </span>
        </button>
      </div>
    </div>
  </main>
</template>
