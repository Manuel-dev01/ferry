<script setup lang="ts">
import {
  CORRIDORS,
  FONBNK_ONRAMP_CHANNELS,
  fonbnkOnrampUrl,
  isCorridorCurrency,
  type CorridorCurrency,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '../components/AppHeader.vue'
import Banner from '../components/Banner.vue'
import Icon from '../components/Icon.vue'
import { COUNTRY_NAMES, FLAGS } from '../lib/corridors'
import { usdtDisplay } from '../lib/format'
import { useCashoutStore } from '../stores/cashout'
import { useHistoryStore } from '../stores/history'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const history = useHistoryStore()
const draft = useCashoutStore()

const WATCH_FAST_MS = 10_000
const WATCH_SLOW_MS = 60_000
const WATCH_FAST_FOR_MS = 30 * 60_000
const WATCH_MAX_MS = 3 * 60 * 60_000

type Phase = 'pick' | 'fonbnk' | 'arrived'
const phase = ref<Phase>('pick')

const currency = ref<CorridorCurrency>(
  isCorridorCurrency(session.host.fiat) ? session.host.fiat : 'NGN',
)
const channel = computed(() => FONBNK_ONRAMP_CHANNELS[currency.value][0] ?? 'mobile_money')

const widgetUrl = computed(() =>
  fonbnkOnrampUrl({
    currency: currency.value,
    channel: channel.value,
    callbackUrl: `${window.location.origin}/fonbnk/return`,
  }),
)

// ---- Wallet ----

const connectBusy = ref(false)
const connectProblem = ref('')
async function connect() {
  connectBusy.value = true
  connectProblem.value = ''
  const result = await session.connectEvm()
  connectBusy.value = false
  if (result === 'rejected') connectProblem.value = t('evm.rejected')
  else if (result === 'unavailable') connectProblem.value = t('evm.unavailable')
  else if (result !== 'ok') connectProblem.value = t('errors.generic')
}

const addressGroups = computed(() =>
  session.evmAddress ? (session.evmAddress.slice(2).match(/.{1,4}/g) ?? []) : [],
)
const copied = ref(false)
async function copyAddress() {
  if (!session.evmAddress) return
  try {
    await navigator.clipboard.writeText(session.evmAddress)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // clipboard blocked: the address is on screen to copy by hand
  }
}

// ---- Watching for the USDT ----

// Fonbnk sends the USDT to the wallet, so a rising balance is the signal it arrived.
const baseline = ref<bigint | null>(null)
const arrivedUnits = ref<bigint | null>(null)
const returned = ref(false)
let watching = false
let stopped = false
let wake: (() => void) | null = null
onUnmounted(() => {
  stopped = true
  wake?.()
})

async function readUsdt(): Promise<bigint | null> {
  try {
    await session.loadBalances()
    return session.balances?.usdt ?? null
  } catch {
    return null
  }
}

async function watchBalance() {
  if (watching) return
  watching = true
  const started = Date.now()
  try {
    while (!stopped && phase.value === 'fonbnk' && Date.now() - started < WATCH_MAX_MS) {
      const elapsed = Date.now() - started
      await new Promise<void>((r) => {
        wake = r
        setTimeout(r, elapsed < WATCH_FAST_FOR_MS ? WATCH_FAST_MS : WATCH_SLOW_MS)
      })
      wake = null
      if (stopped || phase.value !== 'fonbnk') return
      const now = await readUsdt()
      if (now !== null && baseline.value === null) baseline.value = now
      else if (now !== null && baseline.value !== null && now > baseline.value) {
        arrived(now - baseline.value)
        return
      }
    }
  } finally {
    watching = false
  }
}

function arrived(units: bigint) {
  arrivedUnits.value = units
  const id = `topup-${Date.now()}`
  history.add({
    id,
    clientSecret: '',
    createdAt: Date.now(),
    currency: currency.value,
    institutionName: 'Fonbnk',
    recipientMasked: '',
    recipientName: null,
    theyReceiveMinor: '0',
    status: 'received',
    mock: false,
    provider: 'fonbnk',
    kind: 'topup',
    amountUnits: units.toString(),
    channel: channel.value,
  })
  phase.value = 'arrived'
}

async function toFonbnk() {
  if (!session.evmAddress) return
  baseline.value = await readUsdt()
  phase.value = 'fonbnk'
  returned.value = false
  void watchBalance()
}

// Fonbnk's "Back to Ferry" link: the order is done on Fonbnk's side, so check right away.
function onFrameMessage(e: MessageEvent) {
  if (e.origin !== window.location.origin || e.data?.type !== 'ferry:fonbnk-return') return
  if (phase.value !== 'fonbnk') return
  returned.value = true
  wake?.()
}
window.addEventListener('message', onFrameMessage)
onUnmounted(() => window.removeEventListener('message', onFrameMessage))

function cashOut() {
  draft.start('self', currency.value)
  void router.push('/cashout')
}

onMounted(() => {
  const id = route.query.id
  if (typeof id === 'string') {
    const entry = history.find(id)
    if (entry?.kind === 'topup') {
      if (isCorridorCurrency(entry.currency)) currency.value = entry.currency
      arrivedUnits.value = BigInt(entry.amountUnits ?? '0')
      phase.value = 'arrived'
    }
  }
})
</script>

<template>
  <main class="fy-screen">
    <!-- Country and wallet -->
    <template v-if="phase === 'pick'">
      <AppHeader back="/">{{ t('topup.header') }}</AppHeader>
      <div class="fy-content" style="gap: 20px">
        <div class="flex flex-col gap-2">
          <h1 class="fy-display">{{ t('topup.title') }}</h1>
          <p class="fy-lede">{{ t('topup.lede') }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="fy-label">{{ t('topup.payFrom') }}</span>
          <div class="fy-filters" style="flex-wrap: wrap" role="radiogroup">
            <button
              v-for="c in CORRIDORS"
              :key="c.currency"
              type="button"
              class="fy-filter"
              role="radio"
              :aria-checked="currency === c.currency"
              :aria-pressed="currency === c.currency"
              @click="currency = c.currency"
            >
              {{ FLAGS[c.currency] }} {{ COUNTRY_NAMES[c.currency] }}
            </button>
          </div>
          <span class="fy-caption">{{ t(`topup.methods.${currency}`) }}</span>
        </div>

        <section v-if="session.evmAddress" class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('topup.yourAddress') }}</span>
          <div class="s-address" aria-label="Your wallet address">
            <span>0x</span><span v-for="(g, i) in addressGroups" :key="i">{{ g }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="fy-caption">{{ t('topup.addressNote') }}</span>
            <button type="button" class="fy-btn fy-btn--secondary fy-btn--sm" @click="copyAddress">
              <Icon :name="copied ? 'check' : 'copy'" :size="16" />
              {{ copied ? t('topup.copied') : t('topup.copy') }}
            </button>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('topup.howTitle') }}</span>
          <ol class="s-how">
            <li><span>1</span>{{ t('topup.how1') }}</li>
            <li><span>2</span>{{ t('topup.how2') }}</li>
            <li><span>3</span>{{ t('topup.how3') }}</li>
          </ol>
          <p class="fy-caption" style="margin: 0">{{ t('topup.partner') }}</p>
        </section>

        <Banner v-if="connectProblem" tone="brand" :body="connectProblem" />
      </div>
      <div class="fy-bottom">
        <button
          v-if="!session.evmAddress"
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="connectBusy"
          @click="connect"
        >
          {{ connectBusy ? t('home.connecting') : t('topup.connect') }}
        </button>
        <button v-else type="button" class="fy-btn fy-btn--primary" @click="toFonbnk">
          {{ t('topup.continue') }} <Icon name="arrow-right" :size="18" />
        </button>
      </div>
    </template>

    <!-- Fonbnk: the user pays there; Ferry watches the balance -->
    <template v-if="phase === 'fonbnk'">
      <header class="fy-header">
        <button
          type="button"
          class="fy-iconbtn"
          :aria-label="t('common.back')"
          @click="phase = 'pick'"
        >
          <Icon name="back" />
        </button>
        <span class="fy-header__center"
          ><span class="fy-header__title">{{ t('topup.buyBy') }}</span></span
        >
        <span class="fy-header__spacer" />
      </header>
      <div v-if="session.evmAddress" class="s-strip">
        <span class="s-strip__text">
          <span class="fy-caption">{{ t('topup.pasteThis') }}</span>
          <span class="s-mono"
            >{{ session.evmAddress.slice(0, 8) }}…{{ session.evmAddress.slice(-6) }}</span
          >
        </span>
        <button type="button" class="fy-btn fy-btn--secondary fy-btn--sm" @click="copyAddress">
          <Icon :name="copied ? 'check' : 'copy'" :size="16" />
          {{ copied ? t('topup.copied') : t('topup.copy') }}
        </button>
      </div>
      <div v-show="!returned" class="s-widget">
        <iframe
          :src="widgetUrl"
          title="Fonbnk"
          allow="clipboard-read; clipboard-write; camera"
          referrerpolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div v-if="returned" class="fy-content">
        <Banner tone="brand" icon="clock" :body="t('topup.waitingLong')" />
      </div>
      <div class="fy-bottom" style="padding-top: 10px">
        <p class="s-watch" role="status">
          <span class="s-dot" aria-hidden="true" />
          {{
            session.balances
              ? t('topup.watching', { amount: usdtDisplay(session.balances.usdt) })
              : t('topup.watchingNoBalance')
          }}
        </p>
      </div>
    </template>

    <!-- Arrived -->
    <template v-if="phase === 'arrived'">
      <AppHeader close="/" />
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now fy-now--mint" style="margin-top: 4px">
          <div class="fy-now__top">
            <span class="fy-eyebrow">{{ FLAGS[currency] }} {{ COUNTRY_NAMES[currency] }}</span>
            <Icon name="check" :size="18" :stroke="3" />
          </div>
          <span class="fy-now__title">{{ t('topup.arrivedTitle') }}</span>
          <span style="font: 700 20px var(--fy-font-body)">
            +{{ arrivedUnits !== null ? usdtDisplay(arrivedUnits) : '' }} USDT
          </span>
        </div>
        <p class="fy-caption" style="margin: 0">{{ t('topup.arrivedNote') }}</p>
      </div>
      <div class="fy-bottom">
        <RouterLink to="/" class="fy-btn fy-btn--primary">{{ t('topup.home') }}</RouterLink>
        <button type="button" class="fy-btn fy-btn--secondary" @click="cashOut">
          {{ t('topup.cashOut') }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.s-how {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 15px;
}
.s-how li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.s-how li span {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: 700 13px var(--fy-font-body);
  background: var(--fy-surface-2);
}
.s-address {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 14px 16px;
  border-radius: var(--fy-radius-m);
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
  font:
    600 17px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  letter-spacing: 0.02em;
}
.s-address span:first-child,
.s-address span:nth-child(2),
.s-address span:last-child {
  color: var(--fy-brand-text);
  font-weight: 800;
}
.s-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 10px;
  padding: 8px 8px 8px 14px;
  border-radius: var(--fy-radius-m);
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
}
.s-strip__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.s-mono {
  font:
    600 15px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.s-widget {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.s-widget iframe {
  flex: 1;
  width: 100%;
  min-height: 520px;
  border: 0;
  background: #fff;
}
.s-watch {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  color: var(--fy-ink-2);
}
.s-dot {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: var(--fy-brand);
  animation: s-pulse 1.4s ease-in-out infinite;
}
@keyframes s-pulse {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .s-dot {
    animation: none;
  }
}
</style>
