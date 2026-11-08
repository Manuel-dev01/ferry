<script setup lang="ts">
import {
  FONBNK_COUNTRIES,
  fonbnkOfframpUrl,
  formatUsdt,
  isFonbnkCountry,
  MoneyFormatError,
  parseUsdt,
  POLYGON_CHAIN_ID_HEX,
  USDT0_ADDRESS,
  recordCountry,
  type FonbnkChannel,
  type FonbnkCountry,
  type FonbnkCountryInfo,
  type Offer,
  type PayoutRoute,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from 'viem'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import PaymentError from '../../components/PaymentError.vue'
import WalletConnectStrip from '../../components/WalletConnectStrip.vue'
import { ApiRequestError } from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import { channelLabel, countryName, flagOf } from '../../lib/fonbnk'
import { ferryApi } from '../../lib/ferryApi'
import {
  polygonscanTx,
  rateDisplay,
  roughDurationDisplay,
  usdtDisplay,
  wholeFiatDisplay,
} from '../../lib/format'
import { publicSite, shareResult } from '../../lib/share'
import type { WcPayment } from '../../lib/wcBridge'
import {
  classifyEvmError,
  currentChainId,
  evmErrorText,
  sendTransaction,
  switchToPolygon,
} from '../../providers/evm'
import {
  clearUncertainTransfer,
  hasUncertainTransfer,
  markUncertainTransfer,
} from '../../lib/uncertainTransfers'
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

type Phase = 'amount' | 'offers' | 'fonbnk' | 'done' | 'paid'
const phase = ref<Phase>('amount')
const tab = ref<'details' | 'send'>('details')

const queryCountry = route.query.country
const country = ref<FonbnkCountry>(
  isFonbnkCountry(queryCountry)
    ? queryCountry
    : (recordCountry({ currency: draft.currency ?? '' }) ?? 'NG'),
)
const info = computed<FonbnkCountryInfo>(() => FONBNK_COUNTRIES[country.value])
/** The payout currency; Ferry only has rates (for the estimate) for the first four. */
const currency = computed(() => info.value.currency)

/**
 * The same Fonbnk sell flow serves three jobs: cash out to yourself or someone, buy airtime, or
 * pay a Kenyan till or Paybill. Reopened cash-outs infer it from their payout method.
 */
type Mode = 'cashout' | 'airtime' | 'pay'
const PAY_CHANNELS: readonly FonbnkChannel[] = ['buy_goods', 'paybill']
const mode = ref<Mode>(
  route.query.mode === 'airtime' && info.value.airtime
    ? 'airtime'
    : route.query.mode === 'pay' && country.value === 'KE'
      ? 'pay'
      : 'cashout',
)
const channels = computed<readonly FonbnkChannel[]>(() =>
  mode.value === 'airtime'
    ? ['airtime']
    : mode.value === 'pay'
      ? PAY_CHANNELS
      : info.value.cashout.filter((c) => !PAY_CHANNELS.includes(c)),
)
const channel = ref<FonbnkChannel>(channels.value[0] ?? 'bank')
/** Copy for the current job, falling back to the cash-out wording. */
const mt = (key: string, values: Record<string, unknown> = {}) => {
  const own = `fonbnk.modes.${mode.value}.${key}`
  return te(own) ? t(own, values) : t(`fonbnk.${key}`, values)
}
const methodLabel = (c: FonbnkChannel) => channelLabel(t, te, country.value, c)

// ---- Amount ----

const amountInput = ref('')
const minUsdt = computed(() =>
  mode.value === 'airtime' && info.value.airtime ? info.value.airtime.minUsdt : info.value.minUsdt,
)
const minUnits = computed(() => parseUsdt(minUsdt.value))
/** Airtime has its own, much lower, cap. */
const airtimeMax = computed(() =>
  mode.value === 'airtime' && info.value.airtime ? info.value.airtime.maxUsdt : null,
)
const maxUnits = computed(() => {
  let limit = session.meta ? parseUsdt(session.meta.limits.maxUsd) : parseUsdt('200')
  if (airtimeMax.value && parseUsdt(airtimeMax.value) < limit) limit = parseUsdt(airtimeMax.value)
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
  if (units < minUnits.value) return t('fonbnk.tooLow', { amount: minUsdt.value })
  if (session.balances && units > session.balances.usdt && !nimPossible.value) {
    return t('fonbnk.tooHigh')
  }
  if (airtimeMax.value && units > parseUsdt(airtimeMax.value)) {
    return t('fonbnk.airtimeMax', { amount: airtimeMax.value })
  }
  if (session.meta && units > parseUsdt(session.meta.limits.maxUsd)) {
    return t('fonbnk.overLimit', { amount: session.meta.limits.maxUsd })
  }
  return ''
})
const amountOk = computed(() => amountUnits.value !== null && !amountError.value)

/** M-Pesa Direct (Kenya mobile money) and Mavapay Money (NG, KE, ZA banks) accept NIM too. */
const nimPossible = computed(
  () =>
    mode.value === 'cashout' &&
    ((country.value === 'KE' && channel.value === 'mobile_money') ||
      (['NG', 'KE', 'ZA'].includes(country.value) && channel.value === 'bank')),
)
/** Fonbnk is paid in USDT from this wallet, so it needs the balance. */
const routeProblem = ref('')

function useMax() {
  amountInput.value = usdtDisplay(maxUnits.value).replace(/,/g, '')
}

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

// ---- Offers: every route that can deliver this cash-out ----

const offers = ref<Offer[]>([])
const loadingOffers = ref(false)
const OFFER_NAMES: Record<PayoutRoute, string> = {
  fonbnk: 'Fonbnk',
  mpesa_ln: 'M-Pesa Direct',
  mavapay_ln: 'Mavapay Money',
}
const savedMavapay = (() => {
  try {
    return localStorage.getItem('ferry.mavapay.address')
  } catch {
    return null
  }
})()

/** Continue: compare routes when there is more than one, otherwise straight to Fonbnk. */
async function chooseRoute() {
  if (loadingOffers.value || !amountOk.value || amountUnits.value === null) return
  if (mode.value !== 'cashout') return toFonbnk()
  const requestedUnits = amountUnits.value
  const requestedCountry = country.value
  const requestedChannel = channel.value
  loadingOffers.value = true
  try {
    const res = await ferryApi.offers(country.value, channel.value, amountUnits.value)
    if (stopped) return
    offers.value = res.offers
  } catch {
    offers.value = []
  } finally {
    loadingOffers.value = false
  }
  if (
    stopped ||
    amountUnits.value !== requestedUnits ||
    country.value !== requestedCountry ||
    channel.value !== requestedChannel
  ) {
    offers.value = []
    return
  }
  if (offers.value.filter((o) => o.route !== 'fonbnk').length === 0) return toFonbnk()
  phase.value = 'offers'
}

function pickOffer(o: Offer) {
  if (o.route === 'fonbnk') return toFonbnk()
  void router.push({
    path: '/cashout/lightning',
    query: {
      route: o.route,
      units: amountUnits.value?.toString(),
      receive: o.receive,
      currency: o.currency,
      rate: o.rate,
    },
  })
}

function toFonbnk() {
  if (!amountOk.value) return
  routeProblem.value = ''
  const units = amountUnits.value
  if (session.balances && units !== null && units > session.balances.usdt) {
    routeProblem.value = t('offers.needsUsdt', { have: usdtDisplay(session.balances.usdt) })
    return
  }
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

const addressEl = ref<HTMLInputElement | null>(null)
const pasteHint = ref(false)

async function paste() {
  try {
    const text = (await navigator.clipboard.readText()).trim()
    if (text) {
      addressInput.value = text
      return
    }
  } catch {
    // Nimiq Pay blocks clipboard reads: fall through to a long-press paste
  }
  // Focusing opens the keyboard, which on Android offers the copied address as a suggestion
  addressEl.value?.focus()
  pasteHint.value = true
}

const busy = ref(false)
const status = ref('')
const problem = ref('')
const txHash = ref<Hex | null>(null)
const slow = ref(false)
let stopped = false
onUnmounted(() => (stopped = true))

const describe = (err: unknown) =>
  err instanceof ApiRequestError ? friendlyError(err, t) : evmErrorText(err)

// A1: Fonbnk is paid from the connected wallet; connecting is its own tap.
async function connectWallet() {
  problem.value = ''
  busy.value = true
  status.value = t('fonbnk.confirmInWallet')
  const result = await session.connectEvm()
  busy.value = false
  status.value = ''
  if (result === 'rejected') problem.value = t('evm.rejected')
  else if (result !== 'ok') problem.value = t('evm.unavailable')
}

/**
 * A15: after an error the wallet may still have broadcast the transfer. Send stays locked until
 * the user has checked Nimiq Pay's activity and says it didn't go out.
 */
const sendUncertain = ref(false)
watch(
  () => session.evmAddress,
  (address) => {
    sendUncertain.value = !!address && hasUncertainTransfer(address)
    if (sendUncertain.value)
      problem.value = t('fonbnk.sendUncertain', { reason: t('fonbnk.previousUncertain') })
  },
  { immediate: true },
)
function retryAfterCheck() {
  if (session.evmAddress) clearUncertainTransfer(session.evmAddress)
  sendUncertain.value = false
  problem.value = ''
}

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

/**
 * Sends the USDT to Fonbnk. Without arguments it pays the address pasted on the Send tab; with
 * `wc` it pays what Fonbnk asked for over WalletConnect, and hands Fonbnk the hash via onHash.
 */
async function send(wc?: { to: Address; units: bigint; onHash: (hash: Hex) => void }) {
  const to = wc ? wc.to : address.value
  const units = wc ? wc.units : amountUnits.value
  if (
    busy.value ||
    txHash.value ||
    sendUncertain.value ||
    (!wc && (!amountOk.value || addressError.value)) ||
    !to ||
    units === null ||
    !session.evmAddress
  )
    return
  const from = session.evmAddress
  busy.value = true
  problem.value = ''
  try {
    if (session.balances && units > session.balances.usdt) {
      problem.value = t('fonbnk.tooHigh')
      return
    }
    if (!(await checkNetwork())) {
      problem.value = t('fonbnk.wrongNetwork')
      return
    }
    if (stopped) return
    if (session.meta?.gasTopup) {
      status.value = t('fonbnk.gettingGas')
      try {
        const before = session.balances?.pol ?? 0n
        const gas = await ferryApi.gasTopup(from)
        if (gas.status === 'reverted') {
          problem.value = t('fonbnk.gasFailed', { reason: t('fonbnk.gasReverted') })
          return
        }
        if (gas.status === 'pending' || gas.status === 'unknown') {
          // Wait (up to 30 s) for the POL to show, so the wallet sheet doesn't open without gas.
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 3_000))
            if (stopped || session.evmAddress !== from) break
            await session.loadBalances().catch(() => undefined)
            if ((session.balances?.pol ?? 0n) > before) break
          }
        }
      } catch (err) {
        // Not fatal: the wallet may already hold enough POL. Its own sheet will say if not.
        problem.value = t('fonbnk.gasFailed', { reason: describe(err) })
      }
    }
    if (stopped) return
    if (session.evmAddress !== from) {
      problem.value = t('evm.accountChanged')
      return
    }
    status.value = t('fonbnk.confirmInWallet')
    let hash: Hex
    try {
      hash = await sendTransaction({
        from: from as Address,
        to: USDT0_ADDRESS,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, units] }),
      })
    } catch (err) {
      if (classifyEvmError(err) === 'rejected') {
        problem.value = t('fonbnk.cancelled')
        return
      }
      const reason = describe(err)
      // Errors raised before broadcast are certain; anything else may have gone out.
      if (
        /not enough (gas|pol|balance)|insufficient (funds|balance)|gas (fee|limit)/i.test(reason)
      ) {
        // The wallet refused before signing: Polygon's fee rose past the POL it holds. Sending
        // again asks Ferry for a fresh top-up first.
        problem.value = t('fonbnk.feeRose')
      } else if (/execution reverted/i.test(reason)) {
        problem.value = t('fonbnk.sendFailed', { reason })
      } else {
        markUncertainTransfer(from)
        sendUncertain.value = true
        problem.value = t('fonbnk.sendUncertain', { reason })
      }
      return
    }
    problem.value = ''
    txHash.value = hash
    sentAt.value = Date.now()
    sentUnits.value = units
    if (wc) {
      paidOverWc.value = true
      wc.onHash(hash)
    }
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

// ---- Paying over WalletConnect: Fonbnk asks, Ferry shows it, then one approval in Nimiq Pay ----

const wcPayment = ref<WcPayment | null>(null)
/** Fonbnk got the hash over WalletConnect, so there is nothing to paste back. */
const paidOverWc = ref(false)
/** What actually went out; Fonbnk's request can differ from the amount typed. */
const sentUnits = ref<bigint | null>(null)
const wcGroups = computed(() =>
  wcPayment.value ? (wcPayment.value.to.slice(2).match(/.{1,4}/g) ?? []) : [],
)

function onWcPay(p: WcPayment) {
  if (wcPayment.value || txHash.value || sendUncertain.value || busy.value) {
    void p.settle(null)
    return
  }
  problem.value = ''
  wcPayment.value = p
  void checkNetwork()
}

async function payOverWc() {
  const p = wcPayment.value
  if (!p || busy.value) return
  await send({
    to: p.to,
    units: p.units,
    // If Fonbnk can't be told (the connection dropped), fall back to pasting the hash
    onHash: (hash) =>
      void p.settle(hash).then((told) => {
        if (!told) paidOverWc.value = false
      }),
  })
  if (wcPayment.value !== p) return
  if (txHash.value) {
    wcPayment.value = null
  } else if (sendUncertain.value) {
    // It may have gone out: Fonbnk is told no, and the Send tab explains what to check
    void p.settle(null)
    wcPayment.value = null
    tab.value = 'send'
  }
  // Otherwise (declined, fee rose, wrong network) the sheet stays open to try again
}

function declineWcPay() {
  const p = wcPayment.value
  wcPayment.value = null
  problem.value = ''
  if (p) void p.settle(null)
}
onUnmounted(() => void wcPayment.value?.settle(null))

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
        reverted.value = true
        problem.value = t('fonbnk.reverted')
        return
      }
    } catch (err) {
      // A read that fails for good (not a transfer, too old) ends the wait; others retry.
      if (
        err instanceof ApiRequestError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 404 &&
        err.status !== 429
      ) {
        problem.value = friendlyError(err, t)
        slow.value = true
        return
      }
    }
    await new Promise((r) => setTimeout(r, HANDOFF_POLL_MS))
  }
  slow.value = true
}
const confirmed = ref(false)
const reverted = ref(false)
/** "I've got my money" is offered once the transfer is confirmed, or Ferry stopped checking. */
const canMarkPaid = computed(
  () => !!txHash.value && !reverted.value && (confirmed.value || slow.value),
)

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
  if (!txHash.value || !canMarkPaid.value) return
  history.markPaid(txHash.value)
  void history.syncConfirmations() // stats only; never blocks, and retried on the next visit
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

// ---- Share a payout the user confirmed ----

const sharing = ref(false)
async function share() {
  if (amountUnits.value === null) return
  sharing.value = true
  const took = sentAt.value && paidAt.value ? paidAt.value - sentAt.value : null
  // A confirmation tapped much later says nothing about speed, so only quick ones show a time.
  const time = took !== null && took < 60 * 60_000 ? roughDurationDisplay(took) : null
  const amount = `${usdtDisplay(amountUnits.value)} USDT`
  await shareResult({
    amount,
    eyebrow: time ? t('share.eyebrowTimed', { time }) : t('share.eyebrow'),
    place: t('share.place', { country: countryName(country.value), flag: flagOf(country.value) }),
    text: time ? t('share.textTimed', { amount, time }) : t('share.text', { amount }),
    headline: t('home.title'),
    sub: t('share.sub', { site: publicSite() }),
  })
  sharing.value = false
}

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
      const sent = entry.channel as FonbnkChannel | undefined
      if (sent === 'airtime') mode.value = 'airtime'
      else if (sent && PAY_CHANNELS.includes(sent)) mode.value = 'pay'
      channel.value = sent ?? channel.value
      amountInput.value = formatUsdt(BigInt(entry.amountUnits ?? '0'))
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
      reverted.value = entry.status === 'failed'
      if (!confirmed.value && !reverted.value) void follow(tx as Hex)
      return
    }
  }
})
watch(country, () => {
  if (!channels.value.includes(channel.value)) channel.value = channels.value[0] ?? 'bank'
})

const title = computed(() => `${flagOf(country.value)} ${countryName(country.value)}`)

function onBack() {
  if (busy.value) return
  // Once the USDT is sent, back never leads to a screen that could send it again.
  if (phase.value === 'offers') phase.value = 'amount'
  else if (phase.value === 'fonbnk')
    phase.value = txHash.value ? 'done' : offers.value.length > 1 ? 'offers' : 'amount'
  else if (mode.value === 'pay') void router.push('/')
  else void router.push(mode.value === 'airtime' ? '/cashout?mode=airtime' : '/cashout')
}
</script>

<template>
  <main class="fy-screen">
    <!-- Amount and payout method -->
    <template v-if="phase === 'amount'">
      <header class="fy-header">
        <button
          type="button"
          class="fy-iconbtn"
          :aria-label="t('common.back')"
          :disabled="busy"
          @click="onBack"
        >
          <Icon name="back" />
        </button>
        <span class="fy-header__center"
          ><span class="fy-header__title">{{ title }} · {{ mt('step') }}</span></span
        >
        <span class="fy-header__spacer" />
      </header>
      <form class="fy-content" style="gap: 20px" novalidate @submit.prevent="chooseRoute">
        <h1 class="fy-title" style="font-size: 24px; line-height: 1.15">{{ mt('title') }}</h1>

        <div v-if="channels.length > 1" class="flex flex-col gap-1.5">
          <span class="fy-label">{{ mt('method') }}</span>
          <div
            class="fy-filters"
            style="flex-wrap: wrap"
            role="radiogroup"
            :aria-label="mt('method')"
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
        <p v-else-if="mode !== 'airtime'" class="fy-caption" style="margin: 0">
          {{ mt('method') }}: {{ methodLabel(channel) }}
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
          <span v-else class="fy-caption">{{
            airtimeMax
              ? t('fonbnk.airtimeRange', { min: minUsdt, max: airtimeMax })
              : t('fonbnk.min', { amount: minUsdt })
          }}</span>
        </div>

        <Banner v-if="routeProblem" tone="warning" icon="alert" :body="routeProblem" />

        <section class="flex flex-col gap-2">
          <span class="fy-section-label">{{ t('fonbnk.howTitle') }}</span>
          <ol class="s-how">
            <li><span>1</span>{{ mt('how1') }}</li>
            <li><span>2</span>{{ mt('how2') }}</li>
            <li><span>3</span>{{ mt('how3') }}</li>
          </ol>
          <p class="fy-caption" style="margin: 0">{{ t('fonbnk.partner') }}</p>
        </section>
      </form>
      <div class="fy-bottom">
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': loadingOffers }"
          :disabled="!amountOk || loadingOffers"
          @click="chooseRoute"
        >
          {{ loadingOffers ? t('offers.loading') : t('fonbnk.continue') }}
        </button>
      </div>
    </template>

    <!-- Offers: compare every route, like Nimiq Pay's own sell screen -->
    <template v-if="phase === 'offers'">
      <header class="fy-header">
        <button
          type="button"
          class="fy-iconbtn"
          :aria-label="t('common.back')"
          :disabled="busy"
          @click="onBack"
        >
          <Icon name="back" />
        </button>
        <span class="fy-header__center"
          ><span class="fy-header__title">{{ title }}</span></span
        >
        <span class="fy-header__spacer" />
      </header>
      <div class="fy-content" style="gap: 14px">
        <h1 class="fy-display">{{ t('offers.title') }}</h1>
        <div class="s-divider">
          <span>{{
            t('offers.forAmount', { amount: amountUnits ? usdtDisplay(amountUnits) : '' })
          }}</span>
        </div>
        <button
          v-for="o in offers"
          :key="o.route"
          type="button"
          class="s-offer"
          :class="{ 's-offer--best': o.recommended }"
          @click="pickOffer(o)"
        >
          <span v-if="o.recommended" class="s-offer__badge">{{ t('offers.recommended') }}</span>
          <span class="s-offer__from"
            >{{ t('offers.from') }} <strong>{{ OFFER_NAMES[o.route] }}</strong></span
          >
          <span class="s-offer__amount"
            >{{ o.estimate ? '≈ ' : '' }}{{ wholeFiatDisplay(o.receive, o.currency) }}</span
          >
          <span class="s-offer__meta">{{ t(`offers.how.${o.route}`) }}</span>
          <span class="s-offer__foot">
            <Icon name="swap" :size="14" />
            {{
              o.estimate
                ? rateDisplay(o.rate, o.currency).replace('=', '≈')
                : rateDisplay(o.rate, o.currency)
            }}
            <template v-if="o.fee">
              · {{ t('offers.fee', { fee: wholeFiatDisplay(o.fee, o.currency) }) }}</template
            >
            <template v-if="o.route === 'mavapay_ln'">
              · {{ savedMavapay ? savedMavapay : t('offers.needsAccount') }}</template
            >
          </span>
        </button>
        <Banner v-if="routeProblem" tone="warning" icon="alert" :body="routeProblem" />
        <p class="fy-caption" style="margin: 0">{{ t('offers.note') }}</p>
      </div>
    </template>

    <!-- Fonbnk: details in their widget, then Ferry sends the USDT -->
    <template v-if="phase === 'fonbnk'">
      <header class="fy-header">
        <button
          type="button"
          class="fy-iconbtn"
          :aria-label="t('common.back')"
          :disabled="busy"
          @click="onBack"
        >
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
      <!-- "Pay with WalletConnect": Ferry answers for Nimiq Pay, so nothing is pasted back -->
      <WalletConnectStrip
        v-if="session.evmAddress"
        :address="session.evmAddress"
        pay
        @pay="onWcPay"
      />
      <p class="fy-caption" style="margin: 0 16px 8px">
        {{
          txHash
            ? paidOverWc
              ? t('fonbnk.detailsHelpWcSent')
              : t('fonbnk.detailsHelpSent')
            : t('fonbnk.detailsHelp')
        }}
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
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="!canMarkPaid"
          @click="markPaid"
        >
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
              ref="addressEl"
              v-model="addressInput"
              :disabled="busy"
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
          <span v-else-if="pasteHint && !addressInput" class="fy-help">
            {{ t('fonbnk.pasteHint') }}
          </span>
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
      </div>
      <div class="fy-bottom">
        <PaymentError v-if="problem" :body="problem" />
        <button
          v-if="!session.evmAddress"
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy"
          @click="connectWallet"
        >
          {{ busy ? status : t('fonbnk.connectToSend') }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
        <template v-else-if="sendUncertain">
          <button type="button" class="fy-btn fy-btn--secondary" @click="retryAfterCheck">
            {{ t('fonbnk.checkedRetry') }}
          </button>
        </template>
        <button
          v-else-if="onPolygon === false"
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
          @click="send()"
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
            {{ (sentUnits ?? amountUnits) ? usdtDisplay((sentUnits ?? amountUnits)!) : '' }} USDT
          </span>
        </div>

        <Banner v-if="problem" tone="danger" :body="problem" />

        <ol class="s-how s-steps">
          <li :class="{ 's-done': confirmed, 's-failed': reverted }">
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
                    : reverted
                      ? t('fonbnk.reverted')
                      : slow
                        ? t('fonbnk.slow')
                        : t('fonbnk.confirming')
                }}
              </div>
            </div>
          </li>
          <li :class="{ 's-done': paidOverWc }">
            <span
              ><Icon v-if="paidOverWc" name="check" :size="14" :stroke="3" /><template v-else
                >2</template
              ></span
            >
            <div>
              <strong>{{ paidOverWc ? t('fonbnk.step2Wc') : t('fonbnk.step2') }}</strong>
              <div class="fy-caption">
                {{ paidOverWc ? t('fonbnk.step2NoteWc') : t('fonbnk.step2Note') }}
              </div>
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
      <div v-if="reverted" class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="cashOutAgain">
          {{ t('fonbnk.startAgain') }}
        </button>
      </div>
      <div v-else class="fy-bottom">
        <button
          v-if="paidOverWc"
          type="button"
          class="fy-btn fy-btn--primary"
          @click="backToFonbnk"
        >
          {{ t('fonbnk.backToFonbnk') }}
        </button>
        <button
          v-else-if="amountUnits"
          type="button"
          class="fy-btn fy-btn--primary"
          @click="copyAndGo"
        >
          {{ widgetMounted ? t('fonbnk.copyAndBack') : t('fonbnk.copyAndOpen') }}
        </button>
        <button
          type="button"
          class="fy-btn fy-btn--secondary"
          :disabled="!canMarkPaid"
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
          <span class="fy-now__title">{{ mt('paidTitle') }}</span>
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
        <button
          v-if="amountUnits"
          type="button"
          class="fy-btn fy-btn--text fy-btn--sm self-start"
          :disabled="sharing"
          @click="share"
        >
          <Icon name="share" :size="16" /> {{ t('share.button') }}
        </button>
      </div>
      <div class="fy-bottom">
        <RouterLink to="/" class="fy-btn fy-btn--primary">{{ t('fonbnk.home') }}</RouterLink>
        <button type="button" class="fy-btn fy-btn--secondary" @click="cashOutAgain">
          {{ t('fonbnk.again') }}
        </button>
      </div>
    </template>

    <!-- Fonbnk asked for the USDT over WalletConnect: shown here first, then one Nimiq Pay approval -->
    <Teleport to="body">
      <div v-if="wcPayment" class="sheet-backdrop" role="presentation">
        <section class="sheet s-paysheet" role="dialog" aria-modal="true" aria-labelledby="wc-pay">
          <h2 id="wc-pay" class="s-paysheet__title">
            {{ t('fonbnk.wcPayTitle', { amount: usdtDisplay(wcPayment.units) }) }}
          </h2>
          <p class="s-paysheet__body">{{ t('fonbnk.wcPayBody') }}</p>
          <div class="s-address" :aria-label="t('fonbnk.wcPayTo')">
            <span>0x</span><span v-for="(g, i) in wcGroups" :key="i">{{ g }}</span>
          </div>
          <p
            v-if="amountUnits !== null && wcPayment.units !== amountUnits"
            class="fy-help fy-help--error"
          >
            {{ t('fonbnk.wcPayDiffers', { amount: usdtDisplay(amountUnits) }) }}
          </p>
          <PaymentError v-if="problem" :body="problem" />
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
            :disabled="busy"
            @click="payOverWc"
          >
            {{ busy ? status : t('fonbnk.wcPaySend') }}
            <span v-if="busy" class="fy-btn__progress" />
          </button>
          <button
            type="button"
            class="fy-btn fy-btn--secondary"
            :disabled="busy"
            @click="declineWcPay"
          >
            {{ t('wc.decline') }}
          </button>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.s-paysheet {
  background: var(--fy-surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.s-paysheet__title {
  margin: 0;
  font: 800 20px/1.2 var(--fy-font-display);
  letter-spacing: -0.02em;
  color: var(--fy-ink);
}
.s-paysheet__body {
  margin: 0;
  font-size: 14.5px;
  color: var(--fy-ink-2);
}
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
  height: calc(100svh - 250px);
  min-height: 400px;
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
.s-steps li.s-failed > span {
  background: var(--fy-danger);
  color: #fff;
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
.s-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  font: 600 14px var(--fy-font-body);
  color: var(--fy-ink-2);
}
.s-divider::before,
.s-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--fy-line);
}
.s-offer {
  position: relative;
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 16px 14px;
  border-radius: 20px;
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
}
.s-offer--best {
  box-shadow: inset 0 0 0 2px var(--fy-success);
  margin-top: 10px;
}
.s-offer__badge {
  position: absolute;
  top: -12px;
  left: 14px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--fy-card-mint);
  color: var(--fy-card-ink);
  font: 700 12.5px var(--fy-font-body);
}
.s-offer__from {
  font-size: 15px;
}
.s-offer__amount {
  font: 800 30px/1.1 var(--fy-font-display);
  letter-spacing: -0.03em;
}
.s-offer__meta {
  font-size: 13.5px;
  color: var(--fy-ink-2);
}
.s-offer__foot {
  overflow-wrap: anywhere;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--fy-line);
  font-size: 13px;
}
</style>
