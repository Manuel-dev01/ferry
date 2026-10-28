<script setup lang="ts">
import {
  FONBNK_COUNTRIES,
  fonbnkOfframpUrl,
  isCorridorCurrency,
  isFonbnkCountry,
  MoneyFormatError,
  parseUsdt,
  POLYGON_CHAIN_ID_HEX,
  USDT0_ADDRESS,
  recordCountry,
  usdtToFiatMinor,
  type FonbnkChannel,
  type FonbnkCountry,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from 'viem'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import { ApiRequestError } from '../../lib/api'
import { channelLabel, flagOf } from '../../lib/fonbnk'
import { ferryApi } from '../../lib/ferryApi'
import { fiatDisplay, polygonscanTx, usdtDisplay } from '../../lib/format'
import {
  classifyEvmError,
  currentChainId,
  evmErrorText,
  sendTransaction,
  switchToPolygon,
} from '../../providers/evm'
import { useCashoutStore } from '../../stores/cashout'
import { useHistoryStore } from '../../stores/history'
import { useSessionStore } from '../../stores/session'

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()
const history = useHistoryStore()

const HANDOFF_POLL_MS = 4_000
const HANDOFF_POLL_MAX = 45 // 3 minutes, then the page says it's safe to leave

type Phase = 'amount' | 'fonbnk' | 'done' | 'paid'
const phase = ref<Phase>('amount')
const tab = ref<'details' | 'send'>('details')

const queryCountry = route.query.country
const country = ref<FonbnkCountry>(
  isFonbnkCountry(queryCountry)
    ? queryCountry
    : (recordCountry({ currency: draft.currency ?? '' }) ?? 'NG'),
)
const info = computed(() => FONBNK_COUNTRIES[country.value])
/** The payout currency; Ferry only has rates (for the estimate) for the first four. */
const currency = computed(() => info.value.currency)
const channels = computed<readonly FonbnkChannel[]>(() => info.value.cashout)
const channel = ref<FonbnkChannel>(channels.value[0] ?? 'bank')
const methodLabel = (c: FonbnkChannel) => channelLabel(t, te, country.value, c)

// ---- Amount ----

const amountInput = ref('')
const minUnits = computed(() => parseUsdt(info.value.minUsdt))
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
  if (units < minUnits.value) return t('fonbnk.tooLow', { amount: info.value.minUsdt })
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
  const c = currency.value
  if (!isCorridorCurrency(c)) return
  try {
    rate.value = (await ferryApi.quote(c, '10', 'usdt')).rate
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
        country: country.value,
        channel: channel.value,
        amountUnits: amountUnits.value,
        callbackUrl: `${window.location.origin}/fonbnk/return`,
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

// The wallet sends on whatever network it is set to, and the USDT is on Polygon. Switching is its
// own tap and approval, never chained onto the send.
const onPolygon = ref<boolean | null>(null)
async function checkNetwork(): Promise<boolean> {
  try {
    onPolygon.value = (await currentChainId()).toLowerCase() === POLYGON_CHAIN_ID_HEX
  } catch {
    onPolygon.value = null
  }
  return onPolygon.value === true
}
watch(tab, (now) => {
  if (now === 'send') void checkNetwork()
})

async function switchNetwork() {
  busy.value = true
  problem.value = ''
  status.value = t('fonbnk.confirmInWallet')
  try {
    await switchToPolygon()
  } catch (err) {
    problem.value =
      classifyEvmError(err) === 'rejected'
        ? t('fonbnk.switchCancelled')
        : t('fonbnk.switchFailed', { reason: describe(err) })
  } finally {
    await checkNetwork()
    busy.value = false
    status.value = ''
  }
}

async function send() {
  const to = address.value
  const units = amountUnits.value
  if (!to || addressError.value || units === null || !session.evmAddress) return
  busy.value = true
  problem.value = ''
  try {
    if (!(await checkNetwork())) {
      problem.value = t('fonbnk.wrongNetwork')
      return
    }
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
    sentAt.value = Date.now()
    history.add({
      id: hash,
      clientSecret: '',
      createdAt: Date.now(),
      currency: currency.value,
      country: country.value,
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
        country: country.value,
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

/** One tap for the last step: the hash on the clipboard and Fonbnk on screen. */
async function copyAndGo() {
  await copyHash()
  backToFonbnk()
}

// Fonbnk never tells Ferry the payout landed, so the user closes the loop.
const sentAt = ref<number | null>(null)
const paidAt = ref<number | null>(null)
function markPaid() {
  if (!txHash.value) return
  history.markPaid(txHash.value)
  void ferryApi.handoffReceived(txHash.value).catch(() => undefined) // stats only; never blocks
  paidAt.value = history.find(txHash.value)?.paidAt ?? Date.now()
  phase.value = 'paid'
}
const tookText = computed(() => {
  if (!sentAt.value || !paidAt.value) return null
  const minutes = Math.max(1, Math.round((paidAt.value - sentAt.value) / 60_000))
  return minutes < 90
    ? t('fonbnk.tookMinutes', { n: minutes })
    : t('fonbnk.tookHours', { n: Math.round(minutes / 60) })
})

// Fonbnk's "Back to Ferry" link opens /fonbnk/return inside the frame, which tells this page.
function onFrameMessage(e: MessageEvent) {
  if (e.origin !== window.location.origin || e.data?.type !== 'ferry:fonbnk-return') return
  if (txHash.value && phase.value === 'fonbnk') phase.value = 'done'
}
window.addEventListener('message', onFrameMessage)
onUnmounted(() => window.removeEventListener('message', onFrameMessage))

function cashOutAgain() {
  draft.start('self', currency.value)
  void router.push('/cashout')
}

// ---- Entry ----

onMounted(() => {
  void session.loadBalances?.().catch(() => undefined)
  const tx = route.query.tx
  if (typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx)) {
    const entry = history.find(tx)
    if (entry?.provider === 'fonbnk') {
      country.value = recordCountry(entry) ?? country.value
      channel.value = (entry.channel as FonbnkChannel) ?? channel.value
      amountInput.value = usdtDisplay(BigInt(entry.amountUnits ?? '0')).replace(/,/g, '')
      txHash.value = tx as Hex
      sentAt.value = entry.createdAt
      if (entry.status === 'settled') {
        paidAt.value = entry.paidAt ?? null
        confirmed.value = true
        phase.value = 'paid'
        return
      }
      phase.value = 'done'
      confirmed.value = entry.status === 'handed_off'
      if (!confirmed.value) void follow(tx as Hex)
      return
    }
  }
  void loadRate()
})
watch(country, () => {
  if (!channels.value.includes(channel.value)) channel.value = channels.value[0] ?? 'bank'
  void loadRate()
})

const title = computed(() => `${flagOf(country.value)} ${info.value.name}`)

function onBack() {
  // Once the USDT is sent, back never leads to a screen that could send it again.
  if (phase.value === 'fonbnk') phase.value = txHash.value ? 'done' : 'amount'
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
              {{ methodLabel(c) }}
            </button>
          </div>
        </div>
        <p v-else class="fy-caption" style="margin: 0">
          {{ t('fonbnk.method') }}: {{ methodLabel(channel) }}
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
              style="padding: 0 10px"
              @click="useMax"
            >
              {{ t('fonbnk.max') }}
            </button>
          </div>
          <span v-if="amountError" class="fy-help fy-help--error">{{ amountError }}</span>
          <span v-else class="fy-caption">{{ t('fonbnk.min', { amount: info.minUsdt }) }}</span>
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
            {{ txHash ? t('fonbnk.tabSent') : t('fonbnk.tabSend') }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="widgetMounted" v-show="phase === 'fonbnk' && tab === 'details'" class="s-widget">
      <p class="fy-caption" style="margin: 0 16px 8px">
        {{ txHash ? t('fonbnk.detailsHelpSent') : t('fonbnk.detailsHelp') }}
      </p>
      <iframe
        :src="widgetUrl"
        title="Fonbnk"
        allow="clipboard-read; clipboard-write; camera"
        referrerpolicy="strict-origin-when-cross-origin"
      />
    </div>

    <template v-if="phase === 'fonbnk' && tab === 'details'">
      <div v-if="txHash" class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="markPaid">
          {{ t('fonbnk.gotMoney') }}
        </button>
        <button type="button" class="fy-btn fy-btn--text" @click="copyHash">
          <Icon :name="copied ? 'check' : 'copy'" :size="16" />
          {{ copied ? t('fonbnk.copied') : t('fonbnk.copyHash') }}
        </button>
      </div>
      <div v-else class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="tab = 'send'">
          {{ t('fonbnk.haveAddress') }} <Icon name="arrow-right" :size="18" />
        </button>
      </div>
    </template>

    <!-- Already sent: show the transfer, never a second send form -->
    <template v-if="phase === 'fonbnk' && tab === 'send' && txHash">
      <div class="fy-content" style="gap: 18px">
        <Banner
          tone="success"
          icon="check"
          :body="t('fonbnk.alreadySent', { amount: amountUnits ? usdtDisplay(amountUnits) : '' })"
        />
        <section class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('fonbnk.txHash') }}</span>
          <div class="fy-panel s-hash">
            <span>{{ txHash }}</span>
            <button type="button" class="fy-btn fy-btn--secondary fy-btn--sm" @click="copyHash">
              <Icon :name="copied ? 'check' : 'copy'" :size="16" />
              {{ copied ? t('fonbnk.copied') : t('fonbnk.copy') }}
            </button>
          </div>
        </section>
      </div>
      <div class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="tab = 'details'">
          {{ t('fonbnk.backToFonbnk') }}
        </button>
      </div>
    </template>

    <template v-if="phase === 'fonbnk' && tab === 'send' && !txHash">
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
              style="padding: 0 10px"
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

        <Banner
          v-if="onPolygon === false && !problem"
          tone="warning"
          icon="alert"
          :body="t('fonbnk.wrongNetwork')"
        />
        <Banner v-if="problem" tone="danger" :body="problem" />
      </div>
      <div class="fy-bottom">
        <button
          v-if="onPolygon === false"
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy"
          @click="switchNetwork"
        >
          {{ busy ? status : t('fonbnk.switchNetwork') }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
        <button
          v-else
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

        <Banner v-if="problem" tone="danger" :body="problem" />

        <ol class="s-how s-steps">
          <li :class="{ 's-done': confirmed }">
            <span
              ><Icon v-if="confirmed" name="check" :size="14" :stroke="3" /><template v-else
                >1</template
              ></span
            >
            <div>
              <strong>{{ t('fonbnk.step1') }}</strong>
              <div class="fy-caption">
                {{
                  confirmed
                    ? t('fonbnk.step1Done')
                    : slow
                      ? t('fonbnk.slow')
                      : t('fonbnk.confirming')
                }}
              </div>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>{{ t('fonbnk.step2') }}</strong>
              <div class="fy-caption">{{ t('fonbnk.step2Note') }}</div>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>{{ t('fonbnk.step3') }}</strong>
              <div class="fy-caption">{{ t('fonbnk.doneNote') }}</div>
            </div>
          </li>
        </ol>

        <section v-if="txHash" class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('fonbnk.txHash') }}</span>
          <div class="fy-panel s-hash">
            <span>{{ txHash }}</span>
            <button type="button" class="fy-btn fy-btn--secondary fy-btn--sm" @click="copyHash">
              <Icon :name="copied ? 'check' : 'copy'" :size="16" />
              {{ copied ? t('fonbnk.copied') : t('fonbnk.copy') }}
            </button>
          </div>
        </section>
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
        <button v-if="amountUnits" type="button" class="fy-btn fy-btn--primary" @click="copyAndGo">
          {{ widgetMounted ? t('fonbnk.copyAndBack') : t('fonbnk.copyAndOpen') }}
        </button>
        <button
          type="button"
          class="fy-btn fy-btn--secondary"
          :disabled="!confirmed"
          @click="markPaid"
        >
          {{ t('fonbnk.gotMoney') }}
        </button>
      </div>
    </template>

    <!-- Paid: the user confirmed the money arrived -->
    <template v-if="phase === 'paid'">
      <AppHeader close="/" />
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now fy-now--mint" style="margin-top: 4px">
          <div class="fy-now__top">
            <span class="fy-eyebrow">{{ title }}</span>
            <Icon name="check" :size="18" :stroke="3" />
          </div>
          <span class="fy-now__title">{{ t('fonbnk.paidTitle') }}</span>
          <span style="font: 600 16px var(--fy-font-body)">{{ methodLabel(channel) }}</span>
        </div>
        <dl class="fy-panel" style="margin: 0">
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('fonbnk.youSent') }}</dt>
            <dd class="fy-row__v" style="font-weight: 700">
              {{ amountUnits ? usdtDisplay(amountUnits) : '' }} USDT
            </dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('fonbnk.paidBy') }}</dt>
            <dd class="fy-row__v">Fonbnk</dd>
          </div>
          <div v-if="tookText" class="fy-row">
            <dt class="fy-row__k">{{ t('fonbnk.took') }}</dt>
            <dd class="fy-row__v">{{ tookText }}</dd>
          </div>
          <div v-if="txHash" class="fy-row">
            <dt class="fy-row__k">{{ t('fonbnk.transfer') }}</dt>
            <dd class="fy-row__v">
              <a :href="polygonscanTx(txHash)" target="_blank" rel="noopener" class="s-link"
                >{{ txHash.slice(0, 8) }}…{{ txHash.slice(-6) }} <Icon name="external" :size="14"
              /></a>
            </dd>
          </div>
        </dl>
        <p class="fy-caption" style="margin: 0">{{ t('fonbnk.paidNote') }}</p>
      </div>
      <div class="fy-bottom">
        <RouterLink to="/" class="fy-btn fy-btn--primary">{{ t('fonbnk.home') }}</RouterLink>
        <button type="button" class="fy-btn fy-btn--secondary" @click="cashOutAgain">
          {{ t('fonbnk.again') }}
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
.s-steps li > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.s-steps li.s-done > span {
  background: var(--fy-success);
  color: #fff;
}
.s-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--fy-brand-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
