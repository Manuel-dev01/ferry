<script setup lang="ts">
import { isCorridorCurrency, type QuoteResponse } from '@ferry/shared'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Banner from '../components/Banner.vue'
import FerryLogo from '../components/FerryLogo.vue'
import Icon from '../components/Icon.vue'
import Monogram from '../components/Monogram.vue'
import StatusChip from '../components/StatusChip.vue'
import { formatUsdt } from '@ferry/shared'
import { ferryApi } from '../lib/ferryApi'
import { fiatDisplay, shortTimeDisplay, usdtDisplay } from '../lib/format'
import { tinyAddress } from '../lib/names'
import { useCashoutStore } from '../stores/cashout'
import { useHistoryStore, entryAmount, entryLink, entryTitle } from '../stores/history'
import { useSessionStore } from '../stores/session'

const { t, te } = useI18n()
const router = useRouter()
const session = useSessionStore()
const draft = useCashoutStore()
const history = useHistoryStore()

const busy = ref(false)
const msg = ref<{ tone: 'brand' | 'warning' | 'danger'; text: string } | null>(null)

async function connect() {
  msg.value = null
  busy.value = true
  const result = await session.connectEvm()
  busy.value = false
  if (result === 'rejected') msg.value = { tone: 'brand', text: t('evm.rejected') }
  else if (result === 'unavailable') msg.value = { tone: 'warning', text: t('evm.unavailable') }
  else if (result !== 'ok') msg.value = { tone: 'danger', text: t('errors.generic') }
}

// "≈ ₦336,233 at today's rate" in the host's currency, when it's one of ours.
const approx = ref<QuoteResponse | null>(null)
const approxCurrency = computed(() =>
  isCorridorCurrency(session.host.fiat) ? session.host.fiat : 'NGN',
)
watch(
  () => session.balances?.usdt,
  async (usdt) => {
    approx.value = null
    if (!usdt || usdt <= 0n) return
    try {
      approx.value = await ferryApi.quote(approxCurrency.value, formatUsdt(usdt), 'usdt')
    } catch {
      approx.value = null // the estimate is a nice-to-have
    }
  },
  { immediate: true },
)

const recent = computed(() => history.entries.slice(0, 3))
const timeText = (at: number) => shortTimeDisplay(at)

function startCashout(kind: 'self' | 'other') {
  draft.start(kind, session.host.fiat)
  void router.push('/cashout')
}
</script>

<template>
  <main class="fy-screen">
    <header class="fy-header" style="padding: 0 12px 0 20px">
      <FerryLogo />
      <RouterLink
        to="/settings"
        class="fy-iconbtn fy-iconbtn--filled"
        :aria-label="t('home.settings')"
      >
        <Icon name="settings" />
      </RouterLink>
    </header>

    <div class="fy-content" style="gap: 18px">
      <!-- Loading -->
      <template v-if="session.status === 'loading'">
        <div class="fy-balance" aria-busy="true">
          <span
            class="fy-skel"
            style="width: 90px; height: 12px; background: rgba(255, 255, 255, 0.22)"
          />
          <span
            class="fy-skel fy-skel--shimmer"
            style="width: 200px; height: 40px; opacity: 0.35"
          />
          <span
            class="fy-skel"
            style="width: 150px; height: 14px; background: rgba(255, 255, 255, 0.22)"
          />
        </div>
        <div class="flex flex-col gap-3 pt-2">
          <span class="fy-skel" style="width: 80px; height: 14px" />
          <div v-for="i in 2" :key="i" class="flex items-center gap-3">
            <span class="fy-skel" style="width: 44px; height: 44px; border-radius: 12px" />
            <span class="flex-1 flex flex-col gap-2">
              <span class="fy-skel fy-skel--shimmer" style="width: 60%; height: 13px" />
              <span class="fy-skel" style="width: 40%; height: 11px" />
            </span>
          </div>
        </div>
      </template>

      <template v-else>
        <h1 v-if="!session.evmAddress" class="fy-display fy-display--l">{{ t('home.title') }}</h1>

        <!-- Balance: hidden until the user connects -->
        <section class="fy-balance" aria-labelledby="balance-label">
          <template v-if="!session.evmAddress">
            <span id="balance-label" class="fy-eyebrow fy-balance__label">{{
              t('home.balance')
            }}</span>
            <span
              style="
                font: 800 36px/1 var(--fy-font-display);
                letter-spacing: 0.06em;
                color: rgba(255, 255, 255, 0.5);
              "
              aria-hidden="true"
              >•••• <span style="font-size: 18px; letter-spacing: 0">USDT</span></span
            >
            <button
              type="button"
              class="fy-btn fy-btn--cream"
              style="min-height: 48px; font-size: 15.5px; font-weight: 700"
              :disabled="busy"
              @click="connect"
            >
              {{ busy ? t('home.connecting') : t('home.connect') }}
            </button>
            <span class="text-center" style="font-size: 13px; color: #dce1ff">{{
              t('home.connectNote')
            }}</span>
          </template>
          <template v-else>
            <span id="balance-label" class="fy-eyebrow fy-balance__label">
              {{ t('home.balanceAt', { address: tinyAddress(session.evmAddress) }) }}
            </span>
            <span
              v-if="session.balances"
              style="font: 800 44px/1 var(--fy-font-display); letter-spacing: -0.045em"
            >
              {{ usdtDisplay(session.balances.usdt)
              }}<span style="font-size: 20px; letter-spacing: 0"> USDT</span>
            </span>
            <span
              v-else
              class="fy-skel fy-skel--shimmer"
              style="width: 200px; height: 40px; opacity: 0.35"
            />
            <span v-if="approx" style="font-size: 15px; color: #e4e8ff">
              {{
                t('home.approx', { amount: fiatDisplay(approx.theyReceiveMinor, approxCurrency) })
              }}
            </span>
            <div v-if="session.meta?.payoutRoute === 'fonbnk'" class="flex flex-wrap gap-2">
              <RouterLink
                to="/topup"
                class="fy-btn fy-btn--cream fy-btn--sm"
                style="font-weight: 700"
              >
                <Icon name="plus" :size="18" :stroke="2.5" />{{ t('home.addMoney') }}
              </RouterLink>
              <RouterLink
                to="/nim"
                class="fy-btn fy-btn--cream fy-btn--sm"
                style="font-weight: 700"
              >
                <Icon name="swap" :size="18" :stroke="2.5" />{{ t('home.cashOutNim') }}
              </RouterLink>
            </div>
          </template>
        </section>

        <Banner
          v-if="session.meta?.payoutRoute === 'paycrest' && session.meta.paycrestMode === 'mock'"
          tone="warning"
          icon="info"
          :title="t('home.demoTitle')"
          :body="t('home.demoBody')"
        />
        <Banner v-if="msg" :tone="msg.tone" :body="msg.text" />
        <Banner
          v-if="session.balancesError"
          tone="danger"
          :body="t('evm.balanceFailed')"
          :action="t('common.tryAgain')"
          @action="session.loadBalances().catch(() => {})"
        />

        <section
          v-if="session.meta?.payoutRoute === 'fonbnk'"
          aria-labelledby="home-quick"
          class="flex flex-col"
        >
          <h2 id="home-quick" class="fy-section-label" style="margin: 0 0 2px">
            {{ t('home.quickTitle') }}
          </h2>
          <RouterLink to="/cashout?mode=airtime" class="fy-list-row">
            <span class="s-quick" aria-hidden="true"><Icon name="phone" :size="20" /></span>
            <span class="fy-list-row__main">
              <span class="fy-list-row__name">{{ t('home.airtime') }}</span>
              <span class="fy-list-row__meta">{{ t('home.airtimeNote') }}</span>
            </span>
            <Icon name="forward" :size="18" />
          </RouterLink>
          <RouterLink
            :to="{ path: '/cashout/fonbnk', query: { country: 'KE', mode: 'pay' } }"
            class="fy-list-row"
          >
            <span class="s-quick" aria-hidden="true"><Icon name="wallet" :size="20" /></span>
            <span class="fy-list-row__main">
              <span class="fy-list-row__name">{{ t('home.payTill') }}</span>
              <span class="fy-list-row__meta">{{ t('home.payTillNote') }}</span>
            </span>
            <Icon name="forward" :size="18" />
          </RouterLink>
        </section>

        <section v-if="recent.length" aria-labelledby="home-history" class="flex flex-col">
          <div class="flex items-center justify-between" style="min-height: 32px">
            <h2 id="home-history" style="font: 700 17px var(--fy-font-body); margin: 0">
              {{ t('home.history') }}
            </h2>
            <RouterLink
              to="/history"
              class="fy-btn fy-btn--text fy-btn--sm"
              style="min-height: 40px; padding: 0 4px"
            >
              {{ t('common.seeAll') }}
            </RouterLink>
          </div>
          <RouterLink v-for="e in recent" :key="e.id" :to="entryLink(e)" class="fy-list-row">
            <Monogram :name="e.institutionName" />
            <span class="fy-list-row__main">
              <span class="fy-list-row__name">{{ entryTitle(e, t, te) }}</span>
              <span class="fy-list-row__meta"
                >{{ e.institutionName }} · {{ timeText(e.createdAt) }}</span
              >
            </span>
            <span class="fy-list-row__end">
              <span>{{ entryAmount(e) }}</span>
              <StatusChip :status="e.status" />
            </span>
          </RouterLink>
        </section>

        <p v-if="!session.evmAddress || !recent.length" class="fy-note">
          <Icon name="shield" :size="18" />{{ t('home.reach') }}
        </p>
        <RouterLink
          to="/proof"
          class="fy-btn fy-btn--text fy-btn--sm self-start"
          style="padding: 0 4px"
        >
          {{ t('home.proof') }} <Icon name="arrow-right" :size="16" />
        </RouterLink>
      </template>
    </div>

    <div class="fy-bottom" style="gap: 4px">
      <button
        type="button"
        class="fy-btn fy-btn--text"
        style="min-height: 44px"
        @click="startCashout('other')"
      >
        {{ t('home.send') }}
      </button>
      <button type="button" class="fy-btn fy-btn--primary" @click="startCashout('self')">
        {{ t('home.cashOut') }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.s-quick {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--fy-brand-soft);
  color: var(--fy-brand-text);
}
</style>
