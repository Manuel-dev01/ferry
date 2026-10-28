<script setup lang="ts">
import {
  FONBNK_CHANNELS,
  FONBNK_MIN_USDT,
  fonbnkOfframpUrl,
  isCorridorCurrency,
  MoneyFormatError,
  parseUsdt,
  USDT0_ADDRESS,
  usdtToFiatMinor,
  type CorridorCurrency,
  type FonbnkChannel,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from 'viem'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import { ApiRequestError } from '../../lib/api'
import { COUNTRY_NAMES, FLAGS } from '../../lib/corridors'
import { ferryApi } from '../../lib/ferryApi'
import { fiatDisplay, polygonscanTx, usdtDisplay } from '../../lib/format'
import { classifyEvmError, evmErrorText, sendTransaction } from '../../providers/evm'
import { useCashoutStore } from '../../stores/cashout'
import { useHistoryStore } from '../../stores/history'
import { useSessionStore } from '../../stores/session'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()
const history = useHistoryStore()

const HANDOFF_POLL_MS = 4_000
const HANDOFF_POLL_MAX = 45 // 3 minutes, then the page says it's safe to leave

type Phase = 'amount' | 'fonbnk' | 'done'
const phase = ref<Phase>('amount')
const tab = ref<'details' | 'send'>('details')

const currency = ref<CorridorCurrency>(draft.currency ?? 'NGN')
const channels = computed(() => FONBNK_CHANNELS[currency.value])
const channel = ref<FonbnkChannel>(channels.value[0] ?? 'bank')

// ---- Amount ----

const amountInput = ref('')
const minUnits = computed(() => parseUsdt(FONBNK_MIN_USDT[currency.value]))
const maxUnits = computed(() => {
  const limit = session.meta ? parseUsdt(session.meta.limits.maxUsd) : parseUsdt('200')
  const balance = session.balances?.usdt
  return balance !== undefined && balance < limit ? balance : limit
})
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
  const units = amountUnits.value
  if (units === null) return ''
  if (units < minUnits.value) return t('fonbnk.tooLow', { amount: FONBNK_MIN_USDT[currency.value] })
  if (session.balances && units > session.balances.usdt) return t('fonbnk.tooHigh')
  if (session.meta && units > parseUsdt(session.meta.limits.maxUsd)) {
    return t('fonbnk.overLimit', { amount: session.meta.limits.maxUsd })
  }
  return ''
})
const amountOk = computed(() => amountUnits.value !== null && !amountError.value)

function useMax() {
  amountInput.value = usdtDisplay(maxUnits.value).replace(/,/g, '')
}

// Indicative only: Fonbnk quotes the exact payout on its own screen.
const rate = ref<string | null>(null)
async function loadRate() {
  rate.value = null
  try {
    rate.value = (await ferryApi.quote(currency.value, '10', 'usdt')).rate
  } catch {
    // no estimate is fine; Fonbnk shows the real number
  }
}
const estimate = computed(() =>
  rate.value && amountUnits.value
    ? fiatDisplay(usdtToFiatMinor(amountUnits.value, rate.value), currency.value)
    : null,
)

// ---- Fonbnk ----

const widgetUrl = computed(() =>
  amountUnits.value === null
    ? ''
    : fonbnkOfframpUrl({
        currency: currency.value,
        channel: channel.value,
        amountUnits: amountUnits.value,
        callbackUrl: `${window.location.origin}/cashout/fonbnk`,
      }),
)
/** The widget keeps its own state, so it is mounted once and only hidden between tabs. */
const widgetMounted = ref(false)

function toFonbnk() {
  if (!amountOk.value) return
  phase.value = 'fonbnk'
  tab.value = 'details'
  widgetMounted.value = true
}

// ---- Send ----

const addressInput = ref('')
const address = computed<Address | null>(() => {
  const raw = addressInput.value.trim()
  return isAddress(raw, { strict: false }) ? getAddress(raw) : null
})
const addressError = computed(() => {
  if (!addressInput.value.trim()) return ''
  if (!address.value) return t('fonbnk.addressInvalid')
  if (session.evmAddress && address.value === getAddress(session.evmAddress)) {
    return t('fonbnk.addressSelf')
  }
  if (address.value === getAddress(USDT0_ADDRESS)) return t('fonbnk.addressToken')
  return ''
})
const addressGroups = computed(() =>
  address.value ? (address.value.slice(2).match(/.{1,4}/g) ?? []) : [],
)

async function paste() {
  try {
    addressInput.value = (await navigator.clipboard.readText()).trim()
  } catch {
    // clipboard read blocked: the field still takes a long-press paste
  }
}

const busy = ref(false)
const status = ref('')
const problem = ref('')
const txHash = ref<Hex | null>(null)
const slow = ref(false)
let stopped = false
onUnmounted(() => (stopped = true))

const describe = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : evmErrorText(err)

async function send() {
  const to = address.value
  const units = amountUnits.value
  if (!to || addressError.value || units === null || !session.evmAddress) return
  busy.value = true
  problem.value = ''
  try {
    if (session.meta?.gasTopup) {
      status.value = t('fonbnk.gettingGas')
      try {
        await ferryApi.gasTopup(session.evmAddress)
      } catch (err) {
        // Not fatal: the wallet may already hold enough POL. Its own sheet will say if not.
        problem.value = t('fonbnk.gasFailed', { reason: describe(err) })
      }
    }
    status.value = t('fonbnk.confirmInWallet')
    let hash: Hex
    try {
      hash = await sendTransaction({
        from: session.evmAddress as Address,
        to: USDT0_ADDRESS,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, units] }),
      })
    } catch (err) {
      problem.value =
        classifyEvmError(err) === 'rejected'
          ? t('fonbnk.cancelled')
          : t('fonbnk.sendFailed', { reason: describe(err) })
      return
    }
    problem.value = ''
    txHash.value = hash
    history.add({
      id: hash,
      clientSecret: '',
      createdAt: Date.now(),
      currency: currency.value,
      institutionName: 'Fonbnk',
      recipientMasked: '',
      recipientName: null,
      theyReceiveMinor: '0',
      status: 'sending',
      mock: false,
      provider: 'fonbnk',
      txHash: hash,
      amountUnits: units.toString(),
      channel: channel.value,
    })
    phase.value = 'done'
    status.value = t('fonbnk.confirming')
    await follow(hash)
  } finally {
    busy.value = false
    status.value = ''
  }
}

/** Reads the transfer back until it is on-chain. Never resends anything. */
async function follow(hash: Hex) {
  slow.value = false
  for (let i = 0; i < HANDOFF_POLL_MAX && !stopped; i++) {
    try {
      const res = await ferryApi.handoff({
        txHash: hash,
        currency: currency.value,
        channel: channel.value,
      })
      if (res.status === 'confirmed') {
        history.setStatus(hash, 'handed_off')
        confirmed.value = true
        return
      }
      if (res.status === 'reverted') {
        history.setStatus(hash, 'failed')
        problem.value = t('fonbnk.reverted')
        return
      }
    } catch {
      // a failed read is not an outcome
    }
    await new Promise((r) => setTimeout(r, HANDOFF_POLL_MS))
  }
  slow.value = true
}
const confirmed = ref(false)

const copied = ref(false)
async function copyHash() {
  if (!txHash.value) return
  try {
    await navigator.clipboard.writeText(txHash.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // clipboard blocked: the hash is on screen to copy by hand
  }
}

function backToFonbnk() {
  if (!widgetMounted.value && amountUnits.value !== null) widgetMounted.value = true
  phase.value = 'fonbnk'
  tab.value = 'details'
}

// ---- Entry ----

onMounted(() => {
  void session.loadBalances?.().catch(() => undefined)
  const tx = route.query.tx
  if (typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx)) {
    const entry = history.find(tx)
    if (entry?.provider === 'fonbnk') {
      if (isCorridorCurrency(entry.currency)) currency.value = entry.currency
      channel.value = (entry.channel as FonbnkChannel) ?? channel.value
      amountInput.value = usdtDisplay(BigInt(entry.amountUnits ?? '0')).replace(/,/g, '')
      txHash.value = tx as Hex
      phase.value = 'done'
      confirmed.value = entry.status === 'handed_off'
      if (!confirmed.value) void follow(tx as Hex)
      return
    }
  }
  if (!draft.currency) {
    void router.replace('/cashout')
    return
  }
  void loadRate()
})
watch(currency, () => {
  channel.value = channels.value[0] ?? 'bank'
  void loadRate()
})

const title = computed(() => `${FLAGS[currency.value]} ${COUNTRY_NAMES[currency.value]}`)

function onBack() {
  if (phase.value === 'fonbnk') phase.value = 'amount'
  else void router.push('/cashout')
}
</script>

<template>
  <main class="fy-screen">
    <!-- Amount and payout method -->
    <template v-if="phase === 'amount'">
      <header class="fy-header">
        <button type="button" class="fy-iconbtn" :aria-label="t('common.back')" @click="onBack">
          <Icon name="back" />
        </button>
        <span class="fy-header__center"
          ><span class="fy-header__title">{{ title }} · {{ t('fonbnk.step') }}</span></span
        >
        <span class="fy-header__spacer" />
      </header>
      <form class="fy-content" style="gap: 20px" novalidate @submit.prevent="toFonbnk">
        <h1 class="fy-title" style="font-size: 24px; line-height: 1.15">{{ t('fonbnk.title') }}</h1>

        <div v-if="channels.length > 1" class="flex flex-col gap-1.5">
          <span class="fy-label">{{ t('fonbnk.method') }}</span>
          <div
            class="fy-filters"
            style="flex-wrap: wrap"
            role="radiogroup"
            :aria-label="t('fonbnk.method')"
          >
            <button
              v-for="c in channels"
              :key="c"
              type="button"
              class="fy-filter"
              role="radio"
              :aria-checked="channel === c"
              :aria-pressed="channel === c"
              @click="channel = c"
            >
              {{ t(`fonbnk.channels.${currency}.${c}`) }}
            </button>
          </div>
        </div>
        <p v-else class="fy-caption" style="margin: 0">
          {{ t('fonbnk.method') }}: {{ t(`fonbnk.channels.${currency}.${channel}`) }}
        </p>

        <div class="flex flex-col gap-1.5">
          <label class="fy-label" for="fonbnk-amount">{{ t('fonbnk.amount') }}</label>
          <div class="fy-field" :class="{ 'fy-field--error': amountError }">
            <input
              id="fonbnk-amount"
              v-model="amountInput"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
            />
            <span class="fy-field__prefix">USDT</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="fy-caption">
              <template v-if="session.balances">{{
                t('fonbnk.balance', { amount: usdtDisplay(session.balances.usdt) })
              }}</template>
            </span>
            <button
              v-if="session.balances"
              type="button"
              class="fy-btn fy-btn--text fy-btn--sm"
              style="min-height: 32px; padding: 0 10px"
              @click="useMax"
            >
              {{ t('fonbnk.max') }}
            </button>
          </div>
          <span v-if="amountError" class="fy-help fy-help--error">{{ amountError }}</span>
          <span v-else class="fy-caption">{{
            t('fonbnk.min', { amount: FONBNK_MIN_USDT[currency] })
          }}</span>
        </div>

        <div v-if="estimate" class="fy-panel" style="padding: 14px 16px">
          <div style="font: 700 20px var(--fy-font-body)">
            {{ t('fonbnk.estimate', { amount: estimate }) }}
          </div>
          <div class="fy-caption">{{ t('fonbnk.estimateNote') }}</div>
        </div>

        <section class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('fonbnk.howTitle') }}</span>
          <ol class="s-how">
            <li><span>1</span>{{ t('fonbnk.how1') }}</li>
            <li><span>2</span>{{ t('fonbnk.how2') }}</li>
            <li><span>3</span>{{ t('fonbnk.how3') }}</li>
          </ol>
          <p class="fy-caption" style="margin: 0">{{ t('fonbnk.partner') }}</p>
        </section>
      </form>
      <div class="fy-bottom">
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="!amountOk"
          @click="toFonbnk"
        >
          {{ t('fonbnk.continue') }}
        </button>
      </div>
    </template>

    <!-- Fonbnk: details in their widget, then Ferry sends the USDT -->
    <template v-if="phase === 'fonbnk'">
      <header class="fy-header">
        <button type="button" class="fy-iconbtn" :aria-label="t('common.back')" @click="onBack">
          <Icon name="back" />
        </button>
        <span class="fy-header__center"
          ><span class="fy-header__title">{{ t('fonbnk.payoutBy') }}</span></span
        >
        <span class="fy-header__spacer" />
      </header>
      <div style="padding: 0 16px 10px">
        <div class="fy-seg" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-checked="tab === 'details'"
            :aria-selected="tab === 'details'"
            @click="tab = 'details'"
          >
            {{ t('fonbnk.tabDetails') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-checked="tab === 'send'"
            :aria-selected="tab === 'send'"
            @click="tab = 'send'"
          >
            {{ t('fonbnk.tabSend') }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="widgetMounted" v-show="phase === 'fonbnk' && tab === 'details'" class="s-widget">
      <p class="fy-caption" style="margin: 0 16px 8px">{{ t('fonbnk.detailsHelp') }}</p>
      <iframe
        :src="widgetUrl"
        title="Fonbnk"
        allow="clipboard-read; clipboard-write; camera"
        referrerpolicy="strict-origin-when-cross-origin"
      />
    </div>

    <template v-if="phase === 'fonbnk' && tab === 'details'">
      <div class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="tab = 'send'">
          {{ t('fonbnk.haveAddress') }} <Icon name="arrow-right" :size="18" />
        </button>
      </div>
    </template>

    <template v-if="phase === 'fonbnk' && tab === 'send'">
      <div class="fy-content" style="gap: 18px">
        <div class="flex flex-col gap-1.5">
          <label class="fy-label" for="fonbnk-address">{{ t('fonbnk.addressLabel') }}</label>
          <div class="fy-field" :class="{ 'fy-field--error': addressError }">
            <input
              id="fonbnk-address"
              v-model="addressInput"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="0x…"
              style="font-size: 15px"
            />
            <button
              type="button"
              class="fy-btn fy-btn--text fy-btn--sm"
              style="min-height: 36px; padding: 0 10px"
              @click="paste"
            >
              {{ t('fonbnk.paste') }}
            </button>
          </div>
          <span v-if="addressError" class="fy-help fy-help--error">{{ addressError }}</span>
          <span v-else class="fy-caption">{{ t('fonbnk.addressHelp') }}</span>
        </div>

        <template v-if="address && !addressError && amountUnits">
          <section class="flex flex-col gap-2">
            <span class="fy-section-label">{{ t('fonbnk.checkTitle') }}</span>
            <div class="s-address" aria-label="Deposit address">
              <span>0x</span><span v-for="(g, i) in addressGroups" :key="i">{{ g }}</span>
            </div>
          </section>
          <dl class="fy-panel" style="margin: 0">
            <div class="fy-row">
              <dt class="fy-row__k">{{ t('fonbnk.youSend') }}</dt>
              <dd class="fy-row__v" style="font-weight: 700">
                {{ usdtDisplay(amountUnits) }} USDT
              </dd>
            </div>
            <div class="fy-row">
              <dt class="fy-row__k">{{ t('fonbnk.network') }}</dt>
              <dd class="fy-row__v">Polygon</dd>
            </div>
            <div class="fy-row">
              <dt class="fy-row__k">{{ t('fonbnk.to') }}</dt>
              <dd class="fy-row__v">Fonbnk · {{ address.slice(0, 6) }}…{{ address.slice(-4) }}</dd>
            </div>
          </dl>
        </template>

        <Banner v-if="problem" tone="danger" :body="problem" />
      </div>
      <div class="fy-bottom">
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy || !address || !!addressError || !amountUnits"
          @click="send"
        >
          {{
            busy
              ? status
              : t('fonbnk.send', { amount: amountUnits ? usdtDisplay(amountUnits) : '' })
          }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
      </div>
    </template>

    <!-- Sent: hand the transaction hash back to Fonbnk -->
    <template v-if="phase === 'done'">
      <AppHeader close="/" />
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now fy-now--mint" style="margin-top: 4px">
          <div class="fy-now__top">
            <span class="fy-eyebrow">{{ title }}</span>
            <Icon v-if="confirmed" name="check" :size="18" :stroke="3" />
          </div>
          <span class="fy-now__title">{{ t('fonbnk.doneTitle') }}</span>
          <span style="font: 600 16px var(--fy-font-body)">
            {{ amountUnits ? usdtDisplay(amountUnits) : '' }} USDT
          </span>
        </div>

        <Banner
          v-if="!confirmed && !problem"
          tone="brand"
          icon="clock"
          :body="slow ? t('fonbnk.slow') : t('fonbnk.confirming')"
        />
        <Banner v-if="problem" tone="danger" :body="problem" />

        <section v-if="txHash" class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('fonbnk.doneLast') }}</span>
          <div class="fy-panel s-hash">
            <span>{{ txHash }}</span>
            <button type="button" class="fy-btn fy-btn--secondary fy-btn--sm" @click="copyHash">
              <Icon :name="copied ? 'check' : 'copy'" :size="16" />
              {{ copied ? t('fonbnk.copied') : t('fonbnk.copy') }}
            </button>
          </div>
        </section>

        <p class="fy-caption" style="margin: 0">{{ t('fonbnk.doneNote') }}</p>
        <a
          v-if="txHash"
          class="fy-btn fy-btn--text fy-btn--sm self-start"
          :href="polygonscanTx(txHash)"
          target="_blank"
          rel="noopener"
        >
          {{ t('fonbnk.viewTx') }} <Icon name="external" :size="16" />
        </a>
      </div>
      <div class="fy-bottom">
        <button
          v-if="amountUnits"
          type="button"
          class="fy-btn fy-btn--primary"
          @click="backToFonbnk"
        >
          {{ widgetMounted ? t('fonbnk.backToFonbnk') : t('fonbnk.openFonbnk') }}
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
.s-widget {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.s-widget iframe {
  flex: 1;
  width: 100%;
  min-height: 560px;
  border: 0;
  background: #fff;
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
.s-hash {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
}
.s-hash span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font:
    500 13px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
</style>
