<script setup lang="ts">
import { MoneyFormatError, parseUsdt } from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import type { Address } from 'viem'
import AppHeader from '../components/AppHeader.vue'
import Banner from '../components/Banner.vue'
import Icon from '../components/Icon.vue'
import { usdtDisplay } from '../lib/format'
import {
  claimNimSwap,
  createNimSwap,
  nimSwapState,
  quoteNimSwap,
  type NimSwap,
  type NimSwapQuote,
  type NimSwapStage,
} from '../lib/nimSwap'
import { classifyNimiqError, initNimiq } from '../providers/nimiq'
import { useCashoutStore } from '../stores/cashout'
import { useHistoryStore } from '../stores/history'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const history = useHistoryStore()
const draft = useCashoutStore()

const MIN_USDT = '1'
const POLL_MS = 4_000
const POLL_MAX_MS = 45 * 60_000 // past the invoice and HTLC timeouts

type Phase = 'amount' | 'pay' | 'progress' | 'done'
const phase = ref<Phase>('amount')
const problem = ref('')
const busy = ref(false)

// ---- Wallet ----

async function connect() {
  problem.value = ''
  busy.value = true
  const result = await session.connectEvm()
  busy.value = false
  if (result === 'rejected') problem.value = t('evm.rejected')
  else if (result !== 'ok') problem.value = t('evm.unavailable')
}

// ---- Amount and quote ----

const amountInput = ref('')
const maxUsdt = computed(() => session.meta?.limits.maxUsd ?? '200')
const amountUnits = computed<bigint | null>(() => {
  try {
    const units = parseUsdt(amountInput.value.trim())
    return units > 0n ? units : null
  } catch (err) {
    if (err instanceof MoneyFormatError) return null
    throw err
  }
})
const amountError = computed(() => {
  const u = amountUnits.value
  if (u === null) return ''
  if (u < parseUsdt(MIN_USDT)) return t('nimSwap.tooLow', { amount: MIN_USDT })
  if (u > parseUsdt(maxUsdt.value)) return t('nimSwap.tooHigh', { amount: maxUsdt.value })
  return ''
})

const quote = ref<NimSwapQuote | null>(null)
const quoting = ref(false)
const quoteFailed = ref(false)
const quoteRetry = ref(0)
let quoteSeq = 0
let quoteTimer: ReturnType<typeof setTimeout> | undefined
watch([amountUnits, quoteRetry], ([u]) => {
  quoteFailed.value = false
  clearTimeout(quoteTimer)
  quote.value = null
  if (u === null || amountError.value) return
  quoteTimer = setTimeout(async () => {
    const seq = ++quoteSeq
    quoting.value = true
    try {
      const q = await quoteNimSwap(u)
      if (seq === quoteSeq) quote.value = q
    } catch {
      if (seq === quoteSeq) {
        quote.value = null
        quoteFailed.value = true
      }
    } finally {
      if (seq === quoteSeq) quoting.value = false
    }
  }, 400)
})
const satsText = (n: number) => n.toLocaleString('en')

// ---- Swap and payment ----

const swap = ref<NimSwap | null>(null)
const swapUnits = ref<bigint | null>(null)

async function prepare() {
  const units = amountUnits.value
  if (!units || amountError.value || !session.evmAddress) return
  busy.value = true
  problem.value = ''
  try {
    swap.value = await createNimSwap(units, session.evmAddress as Address)
    swapUnits.value = units
    phase.value = 'pay'
  } catch {
    problem.value = t('nimSwap.createFailed')
  } finally {
    busy.value = false
  }
}

const now = ref(Math.floor(Date.now() / 1000))
const clock = setInterval(() => (now.value = Math.floor(Date.now() / 1000)), 1000)
/** null when LendaSwap gave no expiry: Pay stays available and no countdown is shown. */
const secondsLeft = computed(() =>
  swap.value && swap.value.invoiceExpiresAt > 0
    ? Math.max(0, swap.value.invoiceExpiresAt - now.value)
    : null,
)
const countdown = computed(() => {
  const s = secondsLeft.value
  if (s === null) return '—'
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

/** Once the wallet may have paid, this invoice is never offered again. */
const payLocked = ref(false)

function remember(status: string) {
  const s = swap.value
  if (!s || swapUnits.value === null) return
  if (history.find(s.id)) {
    history.setStatus(s.id, status)
    return
  }
  history.add({
    id: s.id,
    clientSecret: '',
    createdAt: Date.now(),
    currency: 'USDT',
    institutionName: 'LendaSwap',
    recipientMasked: '',
    recipientName: null,
    theyReceiveMinor: '0',
    status,
    mock: false,
    kind: 'nim',
    amountUnits: swapUnits.value.toString(),
  })
}

async function pay() {
  const s = swap.value
  if (!s || payLocked.value) return
  busy.value = true
  problem.value = ''
  remember('awaiting')
  try {
    const nimiq = await initNimiq()
    await nimiq.payLightningInvoice({ invoice: s.invoice })
    payLocked.value = true
    remember('swapping')
    phase.value = 'progress'
    void follow()
  } catch (err) {
    const e = classifyNimiqError(err)
    switch (e.kind) {
      case 'rejected':
        history.setStatus(s.id, 'failed')
        problem.value = t('nimSwap.cancelled')
        break
      case 'invalid':
        history.setStatus(s.id, 'failed')
        problem.value = t('nimSwap.expired')
        swap.value = null
        phase.value = 'amount'
        break
      case 'duplicate':
      case 'outcome_unknown':
      case 'network':
        // It may have gone through: never pay again; read the swap's own status instead.
        payLocked.value = true
        remember('swapping')
        phase.value = 'progress'
        void follow()
        break
      case 'unsupported':
        history.setStatus(s.id, 'failed')
        problem.value = t('nimSwap.unsupported')
        break
      default:
        // wallet or unknown errors: it may still have gone out, so follow the swap instead
        payLocked.value = true
        remember('swapping')
        phase.value = 'progress'
        void follow()
    }
  } finally {
    busy.value = false
  }
}

// ---- Progress: wait for the USDT to be locked, then release it ----

const stage = ref<NimSwapStage>('waiting_payment')
const claimTx = ref<string | null>(null)
const slow = ref(false)
let stopped = false
let following = false
onUnmounted(() => {
  stopped = true
  clearInterval(clock)
  clearTimeout(quoteTimer)
})

async function follow() {
  const s = swap.value
  if (!s || following) return
  following = true
  const started = Date.now()
  let claimAsked = false
  try {
    while (!stopped && Date.now() - started < POLL_MAX_MS) {
      try {
        const state = await nimSwapState(s.id)
        stage.value = state.stage
        claimTx.value = state.claimTx
        if (state.stage === 'ready' && !claimAsked) {
          claimAsked = true
          stage.value = 'claiming'
          claimTx.value = (await claimNimSwap(s.id)) ?? claimTx.value
        }
        if (state.stage === 'done') {
          history.setStatus(s.id, 'received')
          void session.loadBalances().catch(() => undefined)
          phase.value = 'done'
          return
        }
        if (state.stage === 'failed') {
          history.setStatus(s.id, 'failed')
          problem.value = t('nimSwap.failed')
          return
        }
      } catch {
        // a failed read or claim is retried on the next round; the claim is idempotent
        claimAsked = stage.value === 'done'
      }
      slow.value = Date.now() - started > 5 * 60_000
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    if (!stopped) stoppedChecking.value = true
  } finally {
    following = false
  }
}
const stoppedChecking = ref(false)
function checkAgain() {
  stoppedChecking.value = false
  void follow()
}

const steps = computed(() => {
  const order: NimSwapStage[] = ['waiting_payment', 'paid', 'ready', 'claiming', 'done']
  const at = order.indexOf(stage.value)
  return [
    { label: t('nimSwap.step1'), done: at >= 1 || stage.value === 'waiting_payment' },
    { label: t('nimSwap.step2'), done: at >= 2 },
    { label: t('nimSwap.step3'), done: at >= 4 },
  ]
})

// ---- Entry ----

onMounted(() => {
  const id = route.query.swap
  if (typeof id !== 'string') return
  const entry = history.find(id)
  if (entry?.kind !== 'nim') return
  swap.value = { id, invoice: '', sats: 0, invoiceExpiresAt: 0 }
  swapUnits.value = BigInt(entry.amountUnits ?? '0')
  payLocked.value = true
  if (entry.status === 'received') {
    phase.value = 'done'
    return
  }
  phase.value = 'progress'
  void follow()
})

function cashOut() {
  draft.start('self', session.host.fiat)
  void router.push('/cashout')
}
</script>

<template>
  <main class="fy-screen">
    <!-- Amount -->
    <template v-if="phase === 'amount'">
      <AppHeader back="/">{{ t('nimSwap.header') }}</AppHeader>
      <div class="fy-content" style="gap: 20px">
        <div class="flex flex-col gap-2">
          <h1 class="fy-display">{{ t('nimSwap.title') }}</h1>
          <p class="fy-lede">{{ t('nimSwap.lede') }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="fy-label" for="nim-amount">{{ t('nimSwap.amount') }}</label>
          <div class="fy-field" :class="{ 'fy-field--error': amountError }">
            <input
              id="nim-amount"
              v-model="amountInput"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
            />
            <span class="fy-field__prefix">USDT</span>
          </div>
          <span v-if="amountError" class="fy-help fy-help--error">{{ amountError }}</span>
          <span v-else class="fy-caption">{{
            t('nimSwap.limits', { min: MIN_USDT, max: maxUsdt })
          }}</span>
        </div>

        <Banner
          v-if="quoteFailed && !quoting"
          tone="warning"
          icon="alert"
          :body="t('nimSwap.quoteFailed')"
          :action="t('common.tryAgain')"
          @action="quoteRetry++"
        />
        <div v-if="quote || quoting" class="fy-panel" style="padding: 14px 16px">
          <template v-if="quote">
            <div style="font: 700 18px var(--fy-font-body)">
              {{ t('nimSwap.quote', { sats: satsText(quote.sats) }) }}
            </div>
            <div class="fy-caption">
              {{ t('nimSwap.quoteNote', { fee: satsText(quote.feeSats) }) }}
            </div>
          </template>
          <span v-else class="fy-caption">{{ t('nimSwap.quoting') }}</span>
        </div>

        <section class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('nimSwap.howTitle') }}</span>
          <ol class="s-how">
            <li><span>1</span>{{ t('nimSwap.how1') }}</li>
            <li><span>2</span>{{ t('nimSwap.how2') }}</li>
            <li><span>3</span>{{ t('nimSwap.how3') }}</li>
          </ol>
          <p class="fy-caption" style="margin: 0">{{ t('nimSwap.safety') }}</p>
        </section>

        <Banner v-if="problem" tone="danger" :body="problem" />
      </div>
      <div class="fy-bottom">
        <button
          v-if="!session.evmAddress"
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="busy"
          @click="connect"
        >
          {{ busy ? t('home.connecting') : t('nimSwap.connect') }}
        </button>
        <button
          v-else
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy || !quote || !!amountError"
          @click="prepare"
        >
          {{ busy ? t('nimSwap.preparing') : t('nimSwap.continue') }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
      </div>
    </template>

    <!-- Pay -->
    <template v-if="phase === 'pay' && swap">
      <header class="fy-header">
        <button
          type="button"
          class="fy-iconbtn"
          :aria-label="t('common.back')"
          :disabled="busy"
          @click="phase = 'amount'"
        >
          <Icon name="back" />
        </button>
        <span class="fy-header__center"
          ><span class="fy-header__title">{{ t('nimSwap.header') }}</span></span
        >
        <span class="fy-header__spacer" />
      </header>
      <div class="fy-content" style="gap: 18px">
        <dl class="fy-panel" style="margin: 0">
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('nimSwap.youGet') }}</dt>
            <dd class="fy-row__v" style="font-weight: 700">
              {{ swapUnits !== null ? usdtDisplay(swapUnits) : '' }} USDT
            </dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('nimSwap.lightning') }}</dt>
            <dd class="fy-row__v">{{ satsText(swap.sats) }} sats</dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('nimSwap.to') }}</dt>
            <dd class="fy-row__v">
              {{ t('nimSwap.yourWallet') }} · {{ session.evmAddress?.slice(0, 6) }}…{{
                session.evmAddress?.slice(-4)
              }}
            </dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('nimSwap.validFor') }}</dt>
            <dd class="fy-row__v">{{ countdown }}</dd>
          </div>
        </dl>
        <p class="fy-caption" style="margin: 0">{{ t('nimSwap.payNote') }}</p>
        <Banner v-if="problem" tone="danger" :body="problem" />
      </div>
      <div class="fy-bottom">
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy || payLocked || secondsLeft === 0"
          @click="pay"
        >
          {{ busy ? t('nimSwap.confirmInWallet') : t('nimSwap.pay') }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
      </div>
    </template>

    <!-- Progress -->
    <template v-if="phase === 'progress'">
      <AppHeader close="/">{{ t('nimSwap.header') }}</AppHeader>
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now" style="margin-top: 4px">
          <span class="fy-eyebrow">{{ t('nimSwap.swapping') }}</span>
          <span class="fy-now__title">
            {{ swapUnits !== null ? usdtDisplay(swapUnits) : '' }} USDT
          </span>
        </div>
        <ol class="s-how s-steps">
          <li v-for="(s, i) in steps" :key="i" :class="{ 's-done': s.done }">
            <span
              ><Icon v-if="s.done" name="check" :size="14" :stroke="3" /><template v-else>{{
                i + 1
              }}</template></span
            >{{ s.label }}
          </li>
        </ol>
        <Banner v-if="problem" tone="danger" :body="problem" />
        <Banner
          v-else-if="!stoppedChecking"
          tone="brand"
          icon="clock"
          :body="slow ? t('nimSwap.slow') : t('nimSwap.waiting')"
        />
        <Banner
          v-if="stoppedChecking && !problem"
          tone="warning"
          icon="clock"
          :body="t('nimSwap.stoppedChecking')"
          :action="t('nimSwap.checkAgain')"
          @action="checkAgain"
        />
      </div>
    </template>

    <!-- Done -->
    <template v-if="phase === 'done'">
      <AppHeader close="/" />
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now fy-now--mint" style="margin-top: 4px">
          <div class="fy-now__top">
            <span class="fy-eyebrow">{{ t('nimSwap.header') }}</span>
            <Icon name="check" :size="18" :stroke="3" />
          </div>
          <span class="fy-now__title">{{ t('nimSwap.doneTitle') }}</span>
          <span style="font: 700 20px var(--fy-font-body)">
            +{{ swapUnits !== null ? usdtDisplay(swapUnits) : '' }} USDT
          </span>
        </div>
        <p class="fy-caption" style="margin: 0">{{ t('nimSwap.doneNote') }}</p>
        <a
          v-if="claimTx"
          class="fy-btn fy-btn--text fy-btn--sm self-start"
          :href="`https://polygonscan.com/tx/${claimTx}`"
          target="_blank"
          rel="noopener"
        >
          {{ t('fonbnk.viewTx') }} <Icon name="external" :size="16" />
        </a>
      </div>
      <div class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="cashOut">
          {{ t('nimSwap.cashOutNow') }}
        </button>
        <RouterLink to="/" class="fy-btn fy-btn--secondary">{{ t('fonbnk.home') }}</RouterLink>
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
.s-how li > span {
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
.s-steps li.s-done > span {
  background: var(--fy-success);
  color: #fff;
}
</style>
