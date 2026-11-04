<script setup lang="ts">
import {
  FONBNK_COUNTRIES,
  FONBNK_TOPUP_COUNTRIES,
  fonbnkOnrampUrl,
  recordCountry,
  type FonbnkChannel,
  type FonbnkCountry,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '../components/AppHeader.vue'
import Banner from '../components/Banner.vue'
import Icon from '../components/Icon.vue'
import PaymentError from '../components/PaymentError.vue'
import WalletConnectStrip from '../components/WalletConnectStrip.vue'
import { countryName, flagOf } from '../lib/fonbnk'
import { usdtDisplay } from '../lib/format'
import { useCashoutStore } from '../stores/cashout'
import { useHistoryStore } from '../stores/history'
import { useSessionStore } from '../stores/session'

const { t, te } = useI18n()
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

const hostCountry = recordCountry({ currency: session.host.fiat ?? '' })
const country = ref<FonbnkCountry>(
  hostCountry && FONBNK_TOPUP_COUNTRIES.includes(hostCountry) ? hostCountry : 'NG',
)
const info = computed(() => FONBNK_COUNTRIES[country.value])
const channel = computed<FonbnkChannel>(() => info.value.topup[0] ?? 'mobile_money')
const methodText = computed(() =>
  te(`topup.methodsByCountry.${country.value}`)
    ? t(`topup.methodsByCountry.${country.value}`)
    : t(`topup.methods.${channel.value}`, { currency: info.value.currency }),
)

const widgetUrl = computed(() =>
  fonbnkOnrampUrl({
    country: country.value,
    channel: channel.value,
    callbackUrl: `${window.location.origin}/fonbnk/return`,
  }),
)

// ---- Wallet ----

const connectBusy = ref(false)
const preparing = ref(false)
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
const widget = ref<HTMLIFrameElement | null>(null)
let activeRun: number | null = null
let watchSequence = 0
let stopped = false
let wake: (() => void) | null = null
function stopWatching() {
  activeRun = null
  watchSequence++
  wake?.()
  wake = null
}
onUnmounted(() => {
  stopped = true
  stopWatching()
})
watch(phase, (next) => {
  if (next !== 'fonbnk') stopWatching()
})
watch(
  () => session.evmAddress,
  () => {
    stopWatching()
    if (phase.value === 'fonbnk') phase.value = 'pick'
    baseline.value = null
  },
)

async function readUsdt(): Promise<bigint | null> {
  try {
    await session.loadBalances()
    return session.balances?.usdt ?? null
  } catch {
    return null
  }
}

async function watchBalance() {
  if (activeRun !== null || stopped || phase.value !== 'fonbnk') return
  const run = ++watchSequence
  activeRun = run
  const started = Date.now()
  try {
    while (
      !stopped &&
      activeRun === run &&
      phase.value === 'fonbnk' &&
      Date.now() - started < WATCH_MAX_MS
    ) {
      const elapsed = Date.now() - started
      await new Promise<void>((r) => {
        const timer = setTimeout(r, elapsed < WATCH_FAST_FOR_MS ? WATCH_FAST_MS : WATCH_SLOW_MS)
        wake = () => {
          clearTimeout(timer)
          r()
        }
      })
      if (stopped || activeRun !== run || phase.value !== 'fonbnk') return
      wake = null
      const now = await readUsdt()
      if (stopped || activeRun !== run || phase.value !== 'fonbnk') return
      if (now !== null && baseline.value === null) baseline.value = now
      else if (now !== null && baseline.value !== null && now > baseline.value) {
        arrived(now - baseline.value)
        return
      }
    }
    if (!stopped && activeRun === run && phase.value === 'fonbnk') stoppedWatching.value = true
  } finally {
    if (activeRun === run) activeRun = null
  }
}
const stoppedWatching = ref(false)
function watchAgain() {
  stoppedWatching.value = false
  void watchBalance()
}

function arrived(units: bigint) {
  arrivedUnits.value = units
  const id = `topup-${Date.now()}`
  history.add({
    id,
    clientSecret: '',
    createdAt: Date.now(),
    currency: info.value.currency,
    country: country.value,
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
  if (preparing.value || !session.evmAddress || phase.value !== 'pick') return
  const address = session.evmAddress
  preparing.value = true
  connectProblem.value = ''
  try {
    const initial = await readUsdt()
    if (stopped || session.evmAddress !== address || phase.value !== 'pick') return
    if (initial === null) {
      connectProblem.value = t('topup.balanceFailed')
      return
    }
    baseline.value = initial
    stoppedWatching.value = false
    phase.value = 'fonbnk'
    returned.value = false
    void watchBalance()
  } finally {
    preparing.value = false
  }
}

// Fonbnk's "Back to Ferry" link: the order is done on Fonbnk's side, so check right away.
function onFrameMessage(e: MessageEvent) {
  if (e.source !== widget.value?.contentWindow) return
  if (e.origin !== window.location.origin || e.data?.type !== 'ferry:fonbnk-return') return
  if (phase.value !== 'fonbnk') return
  returned.value = true
  wake?.()
}
window.addEventListener('message', onFrameMessage)
onUnmounted(() => window.removeEventListener('message', onFrameMessage))

function cashOut() {
  draft.start('self', info.value.currency)
  void router.push('/cashout')
}

onMounted(() => {
  const id = route.query.id
  if (typeof id === 'string') {
    const entry = history.find(id)
    if (entry?.kind === 'topup') {
      country.value = recordCountry(entry) ?? country.value
      arrivedUnits.value = BigInt(entry.amountUnits ?? '0')
      phase.value = 'arrived'
    }
  }
})
</script>

<template>
  <main class="fy-screen" :class="{ 's-topup-widget': phase === 'fonbnk' }">
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
              v-for="c in FONBNK_TOPUP_COUNTRIES"
              :key="c"
              type="button"
              class="fy-filter"
              role="radio"
              :aria-checked="country === c"
              :aria-pressed="country === c"
              @click="country = c"
            >
              {{ flagOf(c) }} {{ countryName(c) }}
            </button>
          </div>
          <span class="fy-caption">{{ methodText }}</span>
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
      </div>
      <div class="fy-bottom">
        <PaymentError v-if="connectProblem" :body="connectProblem" />
        <button
          v-if="!session.evmAddress"
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="connectBusy"
          @click="connect"
        >
          {{ connectBusy ? t('home.connecting') : t('topup.connect') }}
        </button>
        <button
          v-else
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="preparing"
          @click="toFonbnk"
        >
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
      <!-- Fonbnk connects wallets only over WalletConnect; Ferry answers for Nimiq Pay -->
      <WalletConnectStrip v-if="session.evmAddress" :address="session.evmAddress" />
      <div v-show="!returned" class="s-widget">
        <iframe
          ref="widget"
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
        <button
          v-if="stoppedWatching"
          type="button"
          class="fy-btn fy-btn--secondary"
          @click="watchAgain"
        >
          {{ t('topup.watchAgain') }}
        </button>
        <p v-else class="s-watch" role="status">
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
            <span class="fy-eyebrow">{{ flagOf(country) }} {{ countryName(country) }}</span>
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
.s-widget {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.s-widget iframe {
  flex: 1;
  width: 100%;
  /* WalletConnect's wallet picker needs a tall viewport, even on a short phone.
     Let Ferry scroll instead of centering a tall partner modal above the frame. */
  height: max(720px, calc(100svh - 180px));
  min-height: 720px;
  flex: none;
  border: 0;
  background: #fff;
}
.s-topup-widget .fy-bottom {
  position: static;
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
