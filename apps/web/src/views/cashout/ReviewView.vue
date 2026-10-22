<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import DealScreen from '../../components/DealScreen.vue'
import Icon from '../../components/Icon.vue'
import Monogram from '../../components/Monogram.vue'
import { useNow } from '../../composables/useNow'
import { useQuote } from '../../composables/useQuote'
import { errorCode, errorRef } from '../../lib/api'
import { ferryApi } from '../../lib/ferryApi'
import { fiatDisplay, rateDisplay, usdtDisplay } from '../../lib/format'
import { tinyAddress, titleCase } from '../../lib/names'
import { classifyEvmError, signTypedDataV4 } from '../../providers/evm'
import { useCashoutStore } from '../../stores/cashout'
import { useHistoryStore } from '../../stores/history'
import { useSessionStore } from '../../stores/session'

const QUOTE_MS = 90_000
const RATE_TOLERANCE_BPS = 100n // 1%

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()
const history = useHistoryStore()
const now = useNow()

const currency = computed(() => draft.currency!)
const institution = computed(() => draft.institution!)
const name = computed(() => draft.accountName ?? '')
const feePct = computed(() => ((session.meta?.fees.ferryFeeBps ?? 50) / 100).toString())
const { quote, error: quoteError } = useQuote(
  toRef(draft, 'currency'),
  toRef(draft, 'amountInput'),
  toRef(draft, 'amountIn'),
  QUOTE_MS,
)

/** What the user agreed to here. A move of more than 1% needs a fresh yes. */
const accepted = ref<bigint | null>(null)
const rateChangedTo = ref<bigint | null>(null)
const movedTooMuch = (from: bigint, to: bigint) => {
  const diff = from > to ? from - to : to - from
  return diff * 10_000n > from * RATE_TOLERANCE_BPS
}
watch(quote, (q) => {
  if (!q) return
  const theyReceive = BigInt(q.theyReceiveMinor)
  if (accepted.value === null) accepted.value = theyReceive
  else if (movedTooMuch(accepted.value, theyReceive)) rateChangedTo.value = theyReceive
})

type Phase = 'idle' | 'creating' | 'signing' | 'submitting'
const phase = ref<Phase>('idle')
const signOutcome = ref<'cancelled' | 'failed' | null>(null)
const message = ref<{ tone: 'warning' | 'danger'; text: string; ref?: string } | null>(null)

const secondsLeft = computed(() => {
  const order = draft.pendingOrder?.order
  const until = order ? order.validUntil : quote.value ? quote.value.fetchedAt + QUOTE_MS : 0
  return Math.max(0, Math.ceil((until - now.value) / 1000))
})
const timer = computed(() => {
  const s = secondsLeft.value
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

// An unsigned order that expired is useless: drop it so the next tap creates a fresh one.
watch(now, (n) => {
  if (phase.value === 'idle' && draft.pendingOrder && n > draft.pendingOrder.order.validUntil) {
    draft.pendingOrder = null
  }
})

const youSend = computed(() =>
  draft.pendingOrder
    ? BigInt(draft.pendingOrder.order.amountToTransferUnits)
    : quote.value
      ? BigInt(quote.value.youSendUnits)
      : 0n,
)

function acceptNewRate() {
  accepted.value = rateChangedTo.value
  rateChangedTo.value = null
  draft.pendingOrder = null
}

async function confirmAndSign() {
  const evmAddress = session.evmAddress
  if (!evmAddress || !draft.institution || !draft.accountIdentifier || !draft.accountName) return
  message.value = null
  signOutcome.value = null

  // 1. Create the order, or reuse one that's still fresh after a cancelled signature.
  let pending = draft.pendingOrder
  if (
    !pending ||
    pending.order.validUntil - Date.now() < 10_000 ||
    pending.order.refundAddress !== evmAddress
  ) {
    phase.value = 'creating'
    try {
      pending = await ferryApi.createOfframp({
        currency: currency.value,
        institution: draft.institution.code,
        accountIdentifier: draft.accountIdentifier,
        accountName: draft.accountName,
        amount: draft.amountInput,
        amountIn: draft.amountIn,
        evmAddress,
        recipientKind: draft.recipientKind,
      })
      draft.pendingOrder = pending
    } catch (err) {
      phase.value = 'idle'
      message.value = { tone: 'danger', text: t('review.orderFailed'), ref: errorRef(err) }
      return
    }
    const serverAmount = BigInt(pending.order.theyReceiveMinor)
    if (accepted.value !== null && movedTooMuch(accepted.value, serverAmount)) {
      phase.value = 'idle'
      rateChangedTo.value = serverAmount
      return
    }
  }

  // 2. Approval 2: one EIP-712 signature for exactly this transfer.
  phase.value = 'signing'
  let signature: `0x${string}`
  try {
    signature = await signTypedDataV4(evmAddress, pending.signing.typedData)
  } catch (err) {
    phase.value = 'idle'
    signOutcome.value = classifyEvmError(err) === 'rejected' ? 'cancelled' : 'failed'
    return
  }

  // 3. Hand the signature to Ferry, then follow the payout.
  phase.value = 'submitting'
  try {
    const order = await ferryApi.submitSignature(pending.orderId, pending.clientSecret, signature)
    history.add({
      id: order.id,
      clientSecret: pending.clientSecret,
      createdAt: order.createdAt,
      currency: order.currency,
      institutionName: order.institutionName,
      recipientMasked: order.recipientMasked,
      recipientName: draft.accountName,
      theyReceiveMinor: order.theyReceiveMinor,
      status: order.status,
      mock: order.mock,
    })
    await router.replace(`/orders/${order.id}`)
    draft.reset()
  } catch (err) {
    phase.value = 'idle'
    if (errorCode(err) === 'ORDER_EXPIRED') {
      draft.pendingOrder = null
      message.value = { tone: 'warning', text: t('review.expired') }
    } else {
      message.value = { tone: 'danger', text: t('review.orderFailed'), ref: errorRef(err) }
    }
  }
}

function newQuote() {
  draft.pendingOrder = null
  signOutcome.value = null
  accepted.value = null
}

const receiveText = computed(() =>
  quote.value
    ? fiatDisplay(
        draft.pendingOrder?.order.theyReceiveMinor ?? quote.value.theyReceiveMinor,
        currency.value,
      )
    : '',
)
const toLine = computed(() => `${institution.value.name} · ${draft.accountMasked ?? ''}`)
</script>

<template>
  <!-- 08 · Nimiq Pay's sheet is open on top of this -->
  <DealScreen
    v-if="phase === 'signing'"
    color="cobalt"
    :eyebrow="t('sign.waitingEyebrow')"
    :title="`${usdtDisplay(youSend)} USDT`"
    :sub="`to ${titleCase(name)} · ${toLine}`"
    :heading="t('sign.heading')"
    :body="t('sign.body')"
    close="/cashout/review"
  />

  <!-- 08 · Cancelled or failed signature: nothing moved -->
  <DealScreen
    v-else-if="signOutcome"
    color="cream"
    :eyebrow="t('sign.cancelledEyebrow')"
    :title="t('sign.cancelledTitle')"
    :sub="t('sign.cancelledSub', { amount: usdtDisplay(youSend) })"
    :heading="
      signOutcome === 'failed'
        ? t('sign.failedHeading')
        : secondsLeft > 0
          ? t('sign.cancelledHeading', { seconds: secondsLeft })
          : t('sign.cancelledHeadingExpired')
    "
    :body="
      signOutcome === 'failed'
        ? t('sign.failedBody')
        : secondsLeft > 0
          ? t('sign.cancelledBody', { fiat: receiveText, name: titleCase(name) })
          : t('sign.cancelledBodyExpired')
    "
    :primary="secondsLeft > 0 ? t('sign.signAgain') : t('sign.newQuote')"
    :secondary="t('sign.changeAmount')"
    close="/"
    @primary="secondsLeft > 0 ? confirmAndSign() : newQuote()"
    @secondary="router.push('/cashout/amount')"
  />

  <main v-else class="fy-screen">
    <AppHeader back="/cashout/amount" :title="t('review.title')">
      <template #end>
        <span
          class="fy-chip fy-chip--brand"
          style="
            height: 32px;
            padding: 0 10px;
            border-radius: 999px;
            font-size: 13.5px;
            font-weight: 700;
          "
          :aria-label="`${t('review.validFor')} ${timer}`"
        >
          <Icon name="clock" :size="14" :stroke="2.4" />{{ timer }}
        </span>
      </template>
    </AppHeader>

    <div class="fy-content" style="padding-top: 4px; gap: 12px">
      <Banner v-if="rateChangedTo !== null" tone="warning" icon="refund">
        <span
          ><strong>{{ t('review.rateChangedTitle') }}</strong>
          {{ t('review.rateChangedBody', { amount: fiatDisplay(rateChangedTo, currency) }) }}</span
        >
      </Banner>

      <template v-if="quote">
        <div class="flex flex-col gap-1.5" style="padding-top: 4px">
          <span style="font: 600 14px var(--fy-font-body); color: var(--fy-ink-2)">{{
            t('review.theyReceive')
          }}</span>
          <span class="fy-amount" style="overflow-wrap: anywhere; white-space: normal">{{
            receiveText
          }}</span>
        </div>

        <div
          class="flex items-center gap-3"
          style="
            padding: 14px;
            border-radius: 20px;
            background: var(--fy-card-tangerine);
            color: var(--fy-card-ink);
            transform: rotate(-1deg);
          "
        >
          <Monogram :name="institution.name" :seed="institution.code" />
          <span class="flex-1 min-w-0 flex flex-col gap-0.5">
            <span
              style="
                font: 800 17px var(--fy-font-display);
                letter-spacing: -0.01em;
                overflow-wrap: anywhere;
              "
              >{{ name }}</span
            >
            <span style="font-size: 13.5px; font-weight: 500">{{ toLine }}</span>
          </span>
          <span class="flex items-center gap-1" style="font: 700 12.5px var(--fy-font-body)">
            <Icon name="check" :size="14" :stroke="3" />{{ t('review.verified') }}
          </span>
        </div>

        <dl class="fy-rows--flush" style="font-size: 14.5px">
          <div class="fy-row" style="min-height: 50px">
            <dt class="fy-row__k">{{ t('review.youSend') }}</dt>
            <dd class="fy-row__v flex flex-col items-end">
              <span style="font-weight: 700; font-size: 16px"
                >{{ usdtDisplay(BigInt(quote.youSendUnits)) }} USDT</span
              >
              <span style="font-size: 12.5px; color: var(--fy-ink-2)">{{
                t('review.includesFee')
              }}</span>
            </dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('review.rate') }}</dt>
            <dd class="fy-row__v">{{ rateDisplay(quote.rate, currency) }}</dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('review.fee', { pct: feePct }) }}</dt>
            <dd class="fy-row__v">{{ usdtDisplay(BigInt(quote.ferryFeeUnits)) }} USDT</dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('review.networkFee') }}</dt>
            <dd class="fy-row__v" style="font-weight: 700; color: var(--fy-success)">
              {{ t('review.covered') }}
            </dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('review.speed') }}</dt>
            <dd class="fy-row__v">{{ t('review.speedValue') }}</dd>
          </div>
          <div class="fy-row">
            <dt class="fy-row__k">{{ t('review.refunds') }}</dt>
            <dd class="fy-row__v" style="font-weight: 600">
              {{ session.evmAddress ? tinyAddress(session.evmAddress) : '' }}
            </dd>
          </div>
        </dl>
      </template>
      <Banner
        v-else-if="quoteError"
        tone="warning"
        :body="t('amount.noRate')"
        :support-ref="quoteError.ref"
      />
      <div v-else class="flex flex-col gap-3" aria-busy="true">
        <span class="fy-skel" style="width: 90px; height: 14px" />
        <span class="fy-skel fy-skel--shimmer" style="width: 70%; height: 40px" />
        <span class="fy-skel" style="height: 72px; border-radius: 20px" />
      </div>

      <Banner v-if="message" :tone="message.tone" :body="message.text" :support-ref="message.ref" />
    </div>

    <div class="fy-bottom">
      <template v-if="rateChangedTo !== null && accepted !== null">
        <span class="fy-bottom__help">
          {{
            t('review.rateChangedHelp', {
              new: fiatDisplay(rateChangedTo, currency),
              old: fiatDisplay(accepted, currency),
            })
          }}
        </span>
        <button type="button" class="fy-btn fy-btn--primary" @click="acceptNewRate">
          {{ t('review.continueNew') }}
        </button>
        <button
          type="button"
          class="fy-btn fy-btn--text"
          style="min-height: 44px"
          @click="router.push('/cashout/amount')"
        >
          {{ t('review.goBack') }}
        </button>
      </template>
      <template v-else>
        <span class="fy-bottom__help">{{
          secondsLeft > 0 ? t('review.help') : t('review.refreshing')
        }}</span>
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': phase !== 'idle' }"
          :disabled="!quote || phase !== 'idle' || secondsLeft === 0"
          @click="confirmAndSign"
        >
          {{ phase === 'idle' ? t('review.confirm') : t('review.preparing') }}
          <span v-if="phase !== 'idle'" class="fy-btn__progress" />
        </button>
      </template>
    </div>
  </main>
</template>
