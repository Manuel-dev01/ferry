<script setup lang="ts">
import {
  CORRIDORS,
  FONBNK_AIRTIME_COUNTRIES,
  FONBNK_COUNTRIES,
  FONBNK_COUNTRY_CODES,
  recordCountry,
  type CorridorCurrency,
  type FonbnkCountry,
  type FonbnkCountryInfo,
} from '@ferry/shared'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import { FLAGS } from '../../lib/corridors'
import { channelLabel, countryName, flagOf } from '../../lib/fonbnk'
import { useCashoutStore } from '../../stores/cashout'
import { useSessionStore } from '../../stores/session'

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()

// Only an explicit 'paycrest' route shows the retired corridor list; missing meta means Fonbnk.
const viaFonbnk = computed(() => session.meta?.payoutRoute !== 'paycrest')
/** The same list picks a country for airtime: only where Fonbnk sells it. */
const airtime = computed(() => route.query.mode === 'airtime')

// ---- Fonbnk: every country it pays out in ----

/** The user's own country first, from the draft or the host's currency. */
const homeCountry = computed(() =>
  recordCountry({ currency: draft.currency ?? session.host.fiat ?? '' }),
)
const fonbnkRows = computed(() => {
  const codes = [...(airtime.value ? FONBNK_AIRTIME_COUNTRIES : FONBNK_COUNTRY_CODES)]
  const home = homeCountry.value
  if (home) codes.sort((a, b) => Number(b === home) - Number(a === home))
  return codes.map((code) => {
    const info: FonbnkCountryInfo = FONBNK_COUNTRIES[code]
    return {
      code,
      name: countryName(code),
      currency: info.currency,
      methods:
        airtime.value && info.airtime
          ? t('country.airtimeUpTo', { amount: info.airtime.maxUsdt })
          : info.cashout
              .filter((c) => c !== 'paybill' && c !== 'buy_goods')
              .map((c) => channelLabel(t, te, code, c))
              .join(' · '),
    }
  })
})

function chooseCountry(country: FonbnkCountry) {
  const query = airtime.value ? { country, mode: 'airtime' } : { country }
  void router.push({ path: '/cashout/fonbnk', query })
}

// ---- Paycrest: the original four corridors ----

const corridors = computed(() =>
  CORRIDORS.map((c) => ({
    ...c,
    enabled: session.meta?.corridors.find((m) => m.currency === c.currency)?.enabled ?? true,
  })),
)
const paused = computed(() => corridors.value.filter((c) => !c.enabled))

function choose(currency: CorridorCurrency) {
  draft.setCurrency(currency)
  void router.push('/cashout/bank')
}
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/">{{ t('common.step', { step: 1, steps: viaFonbnk ? 3 : 4 }) }}</AppHeader>
    <div class="fy-content">
      <div class="flex flex-col gap-2">
        <h1 class="fy-display">
          {{ airtime ? t('country.airtimeTitle') : t('country.title') }}
        </h1>
        <p class="fy-lede">
          {{
            airtime
              ? t('country.airtimeLede')
              : viaFonbnk
                ? t('country.fonbnkLede')
                : t('country.lede')
          }}
        </p>
      </div>

      <ul
        v-if="viaFonbnk || airtime"
        class="flex flex-col gap-2"
        role="list"
        style="margin: 0; padding: 0; list-style: none"
      >
        <li v-for="c in fonbnkRows" :key="c.code">
          <button
            type="button"
            class="s-country"
            :class="{ 's-country--home': c.code === homeCountry }"
            @click="chooseCountry(c.code)"
          >
            <span style="font-size: 28px; line-height: 1" aria-hidden="true">{{
              flagOf(c.code)
            }}</span>
            <span class="flex-1 min-w-0 flex flex-col gap-0.5">
              <span style="font: 700 16.5px var(--fy-font-body)">{{ c.name }}</span>
              <span class="s-country__methods">{{ c.methods }}</span>
            </span>
            <span
              class="flex items-center gap-1.5"
              style="font: 600 13px var(--fy-font-body); color: var(--fy-ink-2)"
            >
              {{ c.currency }}<Icon name="forward" :size="18" />
            </span>
          </button>
        </li>
      </ul>

      <template v-else>
        <ul
          class="flex flex-col gap-2.5"
          role="list"
          style="margin: 0; padding: 0; list-style: none"
        >
          <li v-for="c in corridors" :key="c.currency">
            <button
              type="button"
              class="w-full flex items-center gap-3.5 text-left"
              style="
                min-height: 80px;
                border-radius: 20px;
                padding: 0 16px;
                background: var(--fy-surface);
                box-shadow: inset 0 0 0 1px var(--fy-line);
              "
              :style="
                draft.currency === c.currency
                  ? { boxShadow: 'inset 0 0 0 2px var(--fy-brand)' }
                  : undefined
              "
              :disabled="!c.enabled"
              @click="choose(c.currency)"
            >
              <span style="font-size: 32px; line-height: 1" aria-hidden="true">{{
                FLAGS[c.currency]
              }}</span>
              <span class="flex-1 min-w-0 flex flex-col gap-0.5">
                <span style="font: 700 17px var(--fy-font-body)">{{ c.name }}</span>
                <span style="font-size: 13.5px; color: var(--fy-ink-2)">{{
                  t(`country.rails.${c.currency}`)
                }}</span>
              </span>
              <span
                v-if="c.enabled"
                class="flex items-center gap-1.5"
                style="font: 600 13px var(--fy-font-body); color: var(--fy-ink-2)"
              >
                {{ t(`country.currency.${c.currency}`) }}<Icon name="forward" :size="18" />
              </span>
              <span v-else class="flex flex-col items-end gap-1">
                <span class="fy-chip fy-chip--warning">{{ t('country.paused') }}</span>
                <span style="font-size: 12px; color: var(--fy-ink-2)">{{
                  t('country.backSoon')
                }}</span>
              </span>
            </button>
          </li>
        </ul>
        <Banner
          v-for="p in paused"
          :key="p.currency"
          tone="warning"
          :body="t('country.pausedBanner', { country: p.name })"
        />
      </template>
    </div>
  </main>
</template>

<style scoped>
.s-country {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  min-height: 68px;
  border-radius: 18px;
  padding: 0 14px;
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
}
.s-country--home {
  box-shadow: inset 0 0 0 2px var(--fy-brand);
}
.s-country__methods {
  font-size: 13px;
  color: var(--fy-ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
