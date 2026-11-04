<script setup lang="ts">
import {
  formatKenyanPhoneLocal,
  mpesaReceiptUrl,
  normalizeKenyanPhone,
  type LnInvoiceResponse,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import PaymentError from '../../components/PaymentError.vue'
import { friendlyError } from '../../lib/errors'
import { ferryApi } from '../../lib/ferryApi'
import { flagOf } from '../../lib/fonbnk'
import {
  lunaForUsdt,
  nimWholeDisplay,
  roughDurationDisplay,
  usdtDisplay,
  wholeFiatDisplay,
} from '../../lib/format'
import { publicSite, shareResult } from '../../lib/share'
import { initNimiq } from '../../providers/nimiq'
import { lightningFailure } from '../../lib/lightningFailure'
import { useHistoryStore } from '../../stores/history'

// One-screen cash-outs over Lightning: the user's Nimiq Pay wallet pays the partner's invoice
// with NIM or USDT (payLightningInvoice). Ferry only fetches the invoice and reads the status.

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const history = useHistoryStore()

type Route = 'mpesa_ln' | 'mavapay_ln'
const kind = ref<Route>(route.query.route === 'mavapay_ln' ? 'mavapay_ln' : 'mpesa_ln')
const units = (() => {
  try {
    return BigInt(String(route.query.units ?? '0'))
  } catch {
    return 0n
  }
})()
/** Local currency per USDT from the offer, for the "≈ USDT" line. */
const rate = typeof route.query.rate === 'string' ? route.query.rate : null
const estimate =
  typeof route.query.receive === 'string' && /^\d{1,20}(?:\.\d{1,20})?$/.test(route.query.receive)
    ? route.query.receive
    : null
const estimateCurrency =
  typeof route.query.currency === 'string' && /^[A-Z]{3}$/.test(route.query.currency)
    ? route.query.currency
    : null

const STATUS_POLL_MS = 3_000
const STATUS_POLL_MAX = 100 // 5 minutes
const KES_MIN = 15
const KES_MAX = 49_000
const ADDRESS_KEY = 'ferry.mavapay.address'

type Phase = 'details' | 'progress' | 'done' | 'failed'
const phase = ref<Phase>('details')
const busy = ref(false)
const status = ref('')
const problem = ref('')

// ---- M-Pesa ----

const phoneInput = ref('')
const phone = computed(() => normalizeKenyanPhone(phoneInput.value))
const phoneError = computed(() => (phoneInput.value.trim() && !phone.value ? t('ln.badPhone') : ''))
const kesInput = ref(kind.value === 'mpesa_ln' && estimate ? estimate : '')
const kes = computed(() => {
  const n = Number(kesInput.value.replace(/[,\s]/g, ''))
  return Number.isInteger(n) && n > 0 ? n : null
})
const kesError = computed(() => {
  if (!kesInput.value.trim()) return ''
  if (kes.value === null) return t('ln.badAmount')
  if (kes.value < KES_MIN || kes.value > KES_MAX) {
    return t('ln.kesRange', { min: KES_MIN, max: KES_MAX.toLocaleString('en') })
  }
  return ''
})
/** ≈ USDT base units for a shilling amount at the offer's rate (display only). */
const usdtApproxUnits = computed(() => {
  if (!rate || !/^\d{1,20}(?:\.\d{1,20})?$/.test(rate) || kes.value === null) return null
  const [whole = '0', frac = ''] = rate.split('.')
  const hundredths = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2))
  if (hundredths === 0n) return null
  return (BigInt(kes.value) * 1_000_000n * 100n) / hundredths
})
const usdtApprox = computed(() =>
  usdtApproxUnits.value === null ? null : usdtDisplay(usdtApproxUnits.value),
)

// The same amount in NIM, so NIM holders see what they'd spend. Nimiq Pay shows the exact amount.
const nimUsd = ref<string | null>(null)
onMounted(() => {
  ferryApi
    .nimPrice()
    .then((p) => (nimUsd.value = p.usd))
    .catch(() => undefined) // the NIM hint is optional
})
const nimApprox = (usdtUnits: bigint | null) => {
  if (usdtUnits === null || !nimUsd.value) return null
  const luna = lunaForUsdt(usdtUnits, nimUsd.value)
  return luna === null ? null : nimWholeDisplay(luna)
}
const maskedPhone = (p: string) => {
  const local = formatKenyanPhoneLocal(p)
  return `${local.slice(0, 4)} ••• ${local.slice(-3)}`
}

// ---- Mavapay Money ----

const addressInput = ref(loadAddress())
function loadAddress() {
  try {
    return localStorage.getItem(ADDRESS_KEY) ?? ''
  } catch {
    return ''
  }
}
const address = computed(() => addressInput.value.trim().toLowerCase())
const addressOk = computed(() => /^[a-z0-9._-]+@mavapay\.money$/.test(address.value))
const addressError = computed(() => (address.value && !addressOk.value ? t('ln.badAddress') : ''))
const showHow = ref(!addressOk.value)

// ---- Pay ----

const invoice = ref<LnInvoiceResponse | null>(null)
const canSend = computed(() =>
  kind.value === 'mpesa_ln'
    ? !!phone.value && kes.value !== null && !kesError.value
    : addressOk.value && units > 0n,
)

const describe = (err: unknown) => friendlyError(err, t)

function remember(inv: LnInvoiceResponse, statusName: string) {
  if (history.find(inv.paymentHash)) {
    history.setStatus(inv.paymentHash, statusName)
    return
  }
  const isMpesa = kind.value === 'mpesa_ln'
  history.add({
    id: inv.paymentHash,
    clientSecret: '',
    createdAt: Date.now(),
    currency: isMpesa ? 'KES' : 'USDT',
    country: isMpesa ? 'KE' : undefined,
    institutionName: isMpesa ? 'M-Pesa' : 'Mavapay Money',
    recipientMasked: '',
    recipientName: null,
    theyReceiveMinor: isMpesa ? String((kes.value ?? 0) * 100) : '0',
    status: statusName,
    mock: false,
    provider: kind.value,
    amountUnits: units.toString(),
    payee: isMpesa && phone.value ? maskedPhone(phone.value) : address.value,
    expiresAt: inv.expiresAt,
  })
}

/**
 * One tap: fetch the invoice, then Nimiq Pay's single approval. The payment is in History
 * before the approval opens, and any outcome other than a clear "you cancelled" is followed up
 * by reading its status. Send is never re-armed for an invoice that may have been paid.
 */
async function send() {
  if (!canSend.value || busy.value) return
  busy.value = true
  problem.value = ''
  try {
    status.value = t('ln.preparing')
    let inv: LnInvoiceResponse
    try {
      inv =
        kind.value === 'mpesa_ln'
          ? await ferryApi.mpesaInvoice(phone.value!, kes.value!)
          : await ferryApi.mavapayInvoice(address.value, units)
    } catch (err) {
      problem.value = describe(err)
      return
    }
    if (kind.value === 'mavapay_ln') {
      try {
        localStorage.setItem(ADDRESS_KEY, address.value)
      } catch {
        // storage unavailable: the address is asked for again next time
      }
    }
    if (stopped) return
    invoice.value = inv
    remember(inv, 'awaiting')
    status.value = t('ln.confirmInWallet')
    let ambiguous = false
    try {
      const nimiq = await initNimiq()
      if (stopped) {
        history.setStatus(inv.paymentHash, 'failed')
        return
      }
      const paid = await nimiq.payLightningInvoice({ invoice: inv.invoice })
      history.update(inv.paymentHash, { walletTx: paid.hash, walletSwapId: paid.swapId })
    } catch (err) {
      const e = lightningFailure(err, inv.expiresAt)
      const ids = e.ids
      if (ids.hash || ids.swapId) {
        history.update(inv.paymentHash, { walletTx: ids.hash, walletSwapId: ids.swapId })
      }
      const settled = (message: string) => {
        history.setStatus(inv.paymentHash, 'failed')
        problem.value = message
      }
      if (e.kind === 'rejected') return settled(t('ln.cancelled'))
      if (e.kind === 'invalid') return settled(t('ln.invalid'))
      if (e.kind === 'insufficient') return settled(t('nimSwap.insufficient'))
      if (e.kind === 'expired') return settled(t('ln.expired'))
      if (e.kind === 'unsupported') return settled(t('ln.unsupported'))
      // duplicate, outcome unknown, network, wallet or unknown errors: it may have gone out.
      ambiguous = true
    }
    history.setStatus(inv.paymentHash, 'sending')
    uncertain.value = ambiguous
    phase.value = 'progress'
    void follow(inv.paymentHash)
  } finally {
    busy.value = false
    status.value = ''
  }
}

// ---- Progress: read the partner's status until there's an answer ----

const receipt = ref<string | null>(null)
const deliveredKes = ref<number | null>(null)
/** Tando has seen the payment (it knows the hash), so "Paid from Nimiq Pay" is true. */
const seenByPartner = ref(false)
/** The payment outcome was ambiguous in Nimiq Pay; done screens must not claim it was sent. */
const uncertain = ref(false)
const slow = ref(false)
const stoppedChecking = ref(false)
const failedReason = ref('')
let stopped = false
let following = false
onUnmounted(() => (stopped = true))

/** An unpaid invoice is dead a minute after it expires: nothing left the wallet. */
const expiredUnpaid = (expiresAt: number) => expiresAt > 0 && Date.now() / 1000 > expiresAt + 60

function fail(hash: string, reason: string) {
  history.setStatus(hash, 'failed')
  failedReason.value = reason
  phase.value = 'failed'
}

async function follow(hash: string) {
  if (following) return
  following = true
  slow.value = false
  stoppedChecking.value = false
  const expiresAt = invoice.value?.expiresAt || history.find(hash)?.expiresAt || 0
  try {
    for (let i = 0; i < STATUS_POLL_MAX && !stopped; i++) {
      try {
        if (kind.value === 'mpesa_ln') {
          const s = await ferryApi.mpesaStatus(hash)
          if (s.kes !== null) deliveredKes.value = s.kes
          if (s.paid) seenByPartner.value = true
          if (s.status === 'completed') {
            receipt.value = s.receipt
            // Timed only when paid in this visit; a reopened payout's finish time is just when it was seen.
            const started = history.find(hash)?.createdAt
            if (!reopened.value && started) tookMs.value = Date.now() - started
            history.markPaid(hash)
            if (s.receipt) history.update(hash, { receipt: s.receipt })
            phase.value = 'done'
            return
          }
          if (s.status === 'failed') return fail(hash, t('ln.mpesaFailed'))
          if (!s.paid && expiredUnpaid(expiresAt)) {
            return fail(hash, t('ln.notPaid'))
          }
        } else {
          const s = await ferryApi.mavapayStatus(hash)
          if (s.status === 'paid') {
            seenByPartner.value = true
            uncertain.value = false
            phase.value = 'done'
            return
          }
          // No status link: Ferry can't confirm. A clean payment shows done; an ambiguous one
          // says so plainly.
          if (s.status === 'unknown') {
            phase.value = 'done'
            return
          }
          if (expiredUnpaid(expiresAt)) return fail(hash, t('ln.notPaid'))
        }
      } catch {
        // a failed read is not an outcome
      }
      if (i === 20) slow.value = true
      await new Promise((r) => setTimeout(r, STATUS_POLL_MS))
    }
    if (!stopped) stoppedChecking.value = true
  } finally {
    following = false
  }
}

function checkAgain() {
  if (invoice.value) void follow(invoice.value.paymentHash)
}

const paidByUser = ref(false)
function markPaid() {
  if (!invoice.value) return
  history.markPaid(invoice.value.paymentHash)
  paidByUser.value = true
}

function tryAgain() {
  invoice.value = null
  problem.value = ''
  phase.value = 'details'
}

// ---- Entry: reopen from history ----

const reopened = ref<{ amount: string; payee: string } | null>(null)
onMounted(() => {
  const hash = route.query.hash
  if (typeof hash !== 'string') return
  const entry = history.find(hash)
  if (!entry || (entry.provider !== 'mpesa_ln' && entry.provider !== 'mavapay_ln')) return
  kind.value = entry.provider
  invoice.value = {
    invoice: '',
    paymentHash: hash,
    sats: 0,
    expiresAt: 0,
    receive: null,
    currency: entry.currency,
  }
  reopened.value = {
    amount:
      entry.provider === 'mpesa_ln'
        ? wholeFiatDisplay(String(BigInt(entry.theyReceiveMinor) / 100n), 'KES')
        : `${usdtDisplay(BigInt(entry.amountUnits ?? '0'))} USDT`,
    payee: entry.payee ?? '',
  }
  invoice.value.expiresAt = entry.expiresAt ?? 0
  receipt.value = entry.receipt ?? null
  paidByUser.value = entry.status === 'settled'
  if (entry.status === 'failed') {
    failedReason.value = t('ln.notPaid')
    phase.value = 'failed'
  } else if (entry.status === 'settled' && (entry.provider === 'mavapay_ln' || entry.receipt)) {
    phase.value = 'done'
  } else {
    // awaiting (the app closed during approval) or sending: read the status, never pay again
    uncertain.value = entry.status === 'awaiting'
    phase.value = 'progress'
    void follow(hash)
  }
})

const sentAmount = computed(() =>
  reopened.value
    ? reopened.value.amount
    : kind.value === 'mpesa_ln'
      ? wholeFiatDisplay(String(deliveredKes.value ?? kes.value ?? 0), 'KES')
      : `${usdtDisplay(units)} USDT`,
)
const sentTo = computed(() =>
  reopened.value
    ? reopened.value.payee
    : kind.value === 'mpesa_ln' && phone.value
      ? maskedPhone(phone.value)
      : address.value,
)
const header = computed(() =>
  kind.value === 'mpesa_ln' ? t('ln.mpesaHeader') : t('ln.mavapayHeader'),
)

// ---- Share a delivered M-Pesa payout ----

const tookMs = ref<number | null>(null)
const sharing = ref(false)
async function share() {
  sharing.value = true
  const time = tookMs.value === null ? null : roughDurationDisplay(tookMs.value)
  const amount = sentAmount.value
  await shareResult({
    amount,
    eyebrow: time ? t('share.eyebrowTimed', { time }) : t('share.eyebrow'),
    place: t('share.placeMpesa', { flag: flagOf('KE') }),
    text: time ? t('share.textTimed', { amount, time }) : t('share.text', { amount }),
    headline: t('home.title'),
    sub: t('share.sub', { site: publicSite() }),
  })
  sharing.value = false
}
</script>

<template>
  <main class="fy-screen">
    <!-- Details -->
    <template v-if="phase === 'details'">
      <AppHeader back="/cashout">{{ header }}</AppHeader>
      <div class="fy-content" style="gap: 18px">
        <template v-if="kind === 'mpesa_ln'">
          <h1 class="fy-title" style="font-size: 24px; line-height: 1.15">
            {{ t('ln.mpesaTitle') }}
          </h1>
          <div class="flex flex-col gap-1.5">
            <label class="fy-label" for="ln-phone">{{ t('ln.phone') }}</label>
            <div class="fy-field" :class="{ 'fy-field--error': phoneError }">
              <span class="fy-field__prefix">🇰🇪 +254</span>
              <input
                id="ln-phone"
                v-model="phoneInput"
                inputmode="tel"
                autocomplete="tel"
                placeholder="0712 345 678"
              />
            </div>
            <span v-if="phoneError" class="fy-help fy-help--error">{{ phoneError }}</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="fy-label" for="ln-kes">{{ t('ln.theyReceive') }}</label>
            <div class="fy-field" :class="{ 'fy-field--error': kesError }">
              <input id="ln-kes" v-model="kesInput" inputmode="numeric" placeholder="0" />
              <span class="fy-field__prefix">KSh</span>
            </div>
            <span v-if="kesError" class="fy-help fy-help--error">{{ kesError }}</span>
            <span v-else-if="usdtApprox" class="fy-caption">{{
              nimApprox(usdtApproxUnits)
                ? t('ln.usdtNimApprox', { amount: usdtApprox, nim: nimApprox(usdtApproxUnits) })
                : t('ln.usdtApprox', { amount: usdtApprox })
            }}</span>
          </div>
          <ul class="s-points">
            <li><Icon name="check" :size="16" :stroke="2.5" />{{ t('ln.point1') }}</li>
            <li><Icon name="check" :size="16" :stroke="2.5" />{{ t('ln.point2') }}</li>
            <li><Icon name="check" :size="16" :stroke="2.5" />{{ t('ln.point3') }}</li>
          </ul>
        </template>

        <template v-else>
          <h1 class="fy-title" style="font-size: 24px; line-height: 1.15">
            {{ t('ln.mavapayTitle') }}
          </h1>
          <dl class="fy-panel" style="margin: 0">
            <div class="fy-row">
              <dt class="fy-row__k">{{ t('ln.youSend') }}</dt>
              <dd class="fy-row__v" style="font-weight: 700">≈ {{ usdtDisplay(units) }} USDT</dd>
            </div>
            <div v-if="nimApprox(units)" class="fy-row">
              <dt class="fy-row__k">{{ t('ln.orNim') }}</dt>
              <dd class="fy-row__v">≈ {{ nimApprox(units) }} NIM</dd>
            </div>
            <div v-if="estimate" class="fy-row">
              <dt class="fy-row__k">{{ t('ln.bankGets') }}</dt>
              <dd class="fy-row__v">
                ≈
                {{
                  estimateCurrency
                    ? wholeFiatDisplay(estimate, estimateCurrency)
                    : Number(estimate).toLocaleString('en')
                }}
              </dd>
            </div>
          </dl>
          <div class="flex flex-col gap-1.5">
            <label class="fy-label" for="ln-address">{{ t('ln.address') }}</label>
            <div class="fy-field" :class="{ 'fy-field--error': addressError }">
              <input
                id="ln-address"
                v-model="addressInput"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="yourname@mavapay.money"
              />
            </div>
            <span v-if="addressError" class="fy-help fy-help--error">{{ addressError }}</span>
            <span v-else class="fy-caption">{{ t('ln.addressHelp') }}</span>
          </div>
          <section class="fy-panel s-how">
            <button type="button" class="s-how__toggle" @click="showHow = !showHow">
              {{ t('ln.howTitle') }}
              <Icon :name="showHow ? 'close' : 'forward'" :size="16" />
            </button>
            <ol v-if="showHow">
              <li>{{ t('ln.how1') }}</li>
              <li>{{ t('ln.how2') }}</li>
              <li>{{ t('ln.how3') }}</li>
              <li>{{ t('ln.how4') }}</li>
            </ol>
          </section>
        </template>
      </div>
      <div class="fy-bottom">
        <PaymentError v-if="problem" :body="problem" />
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy || !canSend"
          @click="send"
        >
          {{
            busy
              ? status
              : kind === 'mpesa_ln'
                ? t('ln.sendKes', { amount: kes ? kes.toLocaleString('en') : '' })
                : t('ln.sendMavapay')
          }}
          <span v-if="busy" class="fy-btn__progress" />
        </button>
        <p class="fy-caption" style="margin: 2px 0 0; text-align: center">
          {{ t('ln.payNote') }}
        </p>
      </div>
    </template>

    <!-- Waiting for the partner's answer -->
    <template v-if="phase === 'progress'">
      <AppHeader close="/">{{ header }}</AppHeader>
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now" style="margin-top: 4px">
          <span class="fy-eyebrow">{{ uncertain ? t('ln.checking') : t('ln.sending') }}</span>
          <span class="fy-now__title">{{ sentAmount }}</span>
          <span class="s-wrap" style="font: 600 15px var(--fy-font-body)">{{ sentTo }}</span>
        </div>
        <ol class="s-steps">
          <li :class="{ 's-done': seenByPartner }">
            <span
              ><Icon v-if="seenByPartner" name="check" :size="14" :stroke="3" /><template v-else
                >1</template
              ></span
            >{{ t('ln.stepPaid') }}
          </li>
          <li><span>2</span>{{ kind === 'mpesa_ln' ? t('ln.stepMpesa') : t('ln.stepMavapay') }}</li>
        </ol>
        <Banner
          v-if="stoppedChecking"
          tone="warning"
          icon="clock"
          :body="t('ln.stoppedChecking')"
        />
        <Banner
          v-else
          tone="brand"
          icon="clock"
          :body="uncertain ? t('ln.uncertain') : slow ? t('ln.slow') : t('ln.waiting')"
        />
      </div>
      <div v-if="stoppedChecking" class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="checkAgain">
          {{ t('ln.checkAgain') }}
        </button>
      </div>
    </template>

    <!-- It didn't go through -->
    <template v-if="phase === 'failed'">
      <AppHeader close="/">{{ header }}</AppHeader>
      <div class="fy-content" style="gap: 18px">
        <Banner tone="danger" :title="t('ln.failedTitle')" :body="failedReason" />
      </div>
      <div class="fy-bottom">
        <button type="button" class="fy-btn fy-btn--primary" @click="tryAgain">
          {{ t('ln.tryAgain') }}
        </button>
        <RouterLink to="/" class="fy-btn fy-btn--secondary">{{ t('fonbnk.home') }}</RouterLink>
      </div>
    </template>

    <!-- Done -->
    <template v-if="phase === 'done'">
      <AppHeader close="/" />
      <div class="fy-content" style="gap: 18px">
        <div class="fy-now fy-now--mint" style="margin-top: 4px">
          <div class="fy-now__top">
            <span class="fy-eyebrow">{{ header }}</span>
            <Icon v-if="receipt || paidByUser" name="check" :size="18" :stroke="3" />
          </div>
          <span class="fy-now__title">{{
            kind === 'mpesa_ln'
              ? t('ln.mpesaDone')
              : uncertain
                ? t('ln.mavapayUnconfirmed')
                : t('ln.mavapayDone')
          }}</span>
          <span style="font: 700 18px var(--fy-font-body)">{{ sentAmount }}</span>
          <span class="s-wrap" style="font: 600 14px var(--fy-font-body)">{{ sentTo }}</span>
        </div>
        <dl v-if="receipt" class="fy-panel" style="margin: 0">
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('ln.receipt') }}</dt>
            <dd class="fy-row__v" style="font-weight: 700; letter-spacing: 0.04em">
              {{ receipt }}
            </dd>
          </div>
        </dl>
        <p v-if="kind === 'mavapay_ln'" class="fy-caption" style="margin: 0">
          {{
            paidByUser
              ? t('ln.mavapayThanks')
              : uncertain
                ? t('ln.mavapayUnconfirmedNote')
                : t('ln.mavapayNote')
          }}
        </p>
        <a
          v-if="kind === 'mpesa_ln' && invoice"
          class="fy-btn fy-btn--text fy-btn--sm self-start"
          :href="mpesaReceiptUrl(invoice.paymentHash)"
          target="_blank"
          rel="noopener"
        >
          {{ t('ln.viewReceipt') }} <Icon name="external" :size="16" />
        </a>
        <button
          v-if="kind === 'mpesa_ln' && receipt"
          type="button"
          class="fy-btn fy-btn--text fy-btn--sm self-start"
          :disabled="sharing"
          @click="share"
        >
          <Icon name="share" :size="16" /> {{ t('share.button') }}
        </button>
      </div>
      <div class="fy-bottom">
        <button
          v-if="kind === 'mavapay_ln' && !paidByUser"
          type="button"
          class="fy-btn fy-btn--primary"
          @click="markPaid"
        >
          {{ t('fonbnk.gotMoney') }}
        </button>
        <RouterLink
          to="/"
          class="fy-btn"
          :class="kind === 'mavapay_ln' && !paidByUser ? 'fy-btn--secondary' : 'fy-btn--primary'"
          >{{ t('fonbnk.home') }}</RouterLink
        >
        <button
          v-if="kind === 'mpesa_ln'"
          type="button"
          class="fy-btn fy-btn--secondary"
          @click="router.push('/cashout')"
        >
          {{ t('fonbnk.again') }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.s-points {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14.5px;
}
.s-points li {
  display: flex;
  gap: 10px;
  align-items: center;
}
.s-points li :deep(svg) {
  color: var(--fy-success);
  flex: none;
}
.s-how {
  padding: 4px 16px 12px;
}
.s-how__toggle {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: 700 15px var(--fy-font-body);
}
.s-how ol {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--fy-ink-2);
}
.s-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 15px;
}
.s-steps li {
  display: flex;
  gap: 12px;
  align-items: center;
}
.s-steps li > span {
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
.s-wrap {
  overflow-wrap: anywhere;
  min-width: 0;
}
</style>
