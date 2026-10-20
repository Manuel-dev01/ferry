<script setup lang="ts">
import { maskName, shortAddress } from '@ferry/shared'
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import BottomAction from '../../components/BottomAction.vue'
import Monogram from '../../components/Monogram.vue'
import StatusMessage from '../../components/StatusMessage.vue'
import TopBar from '../../components/TopBar.vue'
import { useNow } from '../../composables/useNow'
import { useQuote } from '../../composables/useQuote'
import { errorCode, errorRef } from '../../lib/api'
import { ferryApi } from '../../lib/ferryApi'
import { fiatDisplay, rateDisplay, usdtDisplay } from '../../lib/format'
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
const { quote, error: quoteError } = useQuote(
  toRef(draft, 'currency'),
  toRef(draft, 'amountInput'),
  toRef(draft, 'amountIn'),
  QUOTE_MS,
)

/** What the user agreed to on this screen. A move of more than 1% needs a fresh yes. */
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

const secondsLeft = computed(() => {
  const order = draft.pendingOrder?.order
  const until = order ? order.validUntil : quote.value ? quote.value.fetchedAt + QUOTE_MS : 0
  return Math.max(0, Math.ceil((until - now.value) / 1000))
})

// An unsigned order that expired is useless: drop it so the next tap creates a fresh one.
watch(now, (n) => {
  if (phase.value === 'idle' && draft.pendingOrder && n > draft.pendingOrder.order.validUntil) {
    draft.pendingOrder = null
  }
})

type Phase = 'idle' | 'creating' | 'signing' | 'submitting'
const phase = ref<Phase>('idle')
const message = ref<{ tone: 'info' | 'warn' | 'error'; text: string; ref?: string } | null>(null)

function acceptNewRate() {
  accepted.value = rateChangedTo.value
  rateChangedTo.value = null
  draft.pendingOrder = null
}

async function confirmAndSign() {
  const evmAddress = session.evmAddress
  if (!evmAddress || !draft.institution || !draft.accountIdentifier || !draft.accountName) return
  message.value = null

  // 1. Create the order (or reuse one that's still fresh after a cancelled signature).
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
      message.value = { tone: 'error', text: t('review.orderFailed'), ref: errorRef(err) }
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
    const seconds = Math.max(0, Math.ceil((pending.order.validUntil - Date.now()) / 1000))
    message.value =
      classifyEvmError(err) === 'rejected'
        ? { tone: 'info', text: t('review.signRejected', { seconds }) }
        : { tone: 'error', text: t('review.signFailed') }
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
      recipientName: maskName(draft.accountName),
      theyReceiveMinor: order.theyReceiveMinor,
      status: order.status,
      mock: order.mock,
    })
    draft.reset()
    void router.replace(`/orders/${order.id}`)
  } catch (err) {
    phase.value = 'idle'
    if (errorCode(err) === 'ORDER_EXPIRED') {
      draft.pendingOrder = null
      message.value = { tone: 'warn', text: t('review.expired') }
    } else {
      message.value = { tone: 'error', text: t('review.orderFailed'), ref: errorRef(err) }
    }
  }
}

const busyLabel = computed(() =>
  phase.value === 'signing'
    ? t('review.signing')
    : phase.value === 'idle'
      ? null
      : t('review.creating'),
)
</script>

<template>
  <main class="page">
    <TopBar :title="t('review.title')" :step="5" :steps="5" back="/cashout/amount" />

    <section v-if="quote" class="card">
      <p class="text-sm font-semibold text-neutral-800">{{ t('review.theyReceive') }}</p>
      <p class="text-4xl font-bold mb-4">{{ fiatDisplay(quote.theyReceiveMinor, currency) }}</p>

      <div class="flex items-center gap-3 mb-4">
        <Monogram :name="draft.accountName!" size="sm" />
        <p class="flex-1">
          <span class="block font-semibold">{{ draft.accountName }}</span>
          <span class="block text-sm text-neutral-800">
            {{ draft.institution!.name }} · <span class="font-mono">{{ draft.accountMasked }}</span>
          </span>
        </p>
      </div>

      <dl>
        <div class="row">
          <dt class="row-label">{{ t('review.youSend') }}</dt>
          <dd class="row-value">
            {{ usdtDisplay(BigInt(quote.youSendUnits)) }} USDT
            <span class="block text-xs font-normal text-neutral-800">
              {{ t('review.includesFee', { fee: usdtDisplay(BigInt(quote.ferryFeeUnits)) }) }}
            </span>
          </dd>
        </div>
        <div class="row">
          <dt class="row-label">{{ t('review.rate') }}</dt>
          <dd class="row-value">{{ rateDisplay(quote.rate, currency) }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">{{ t('review.networkFee') }}</dt>
          <dd class="row-value text-green-1100">{{ t('review.networkFeeCovered') }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">{{ t('review.arrives') }}</dt>
          <dd class="row-value">{{ t('review.arrivesValue') }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">{{ t('review.refunds') }}</dt>
          <dd class="row-value font-mono">{{ shortAddress(session.evmAddress ?? '') }}</dd>
        </div>
      </dl>
    </section>
    <template v-else-if="quoteError">
      <StatusMessage tone="error" :text="t('amount.quoteFailed')" :support-ref="quoteError.ref" />
    </template>
    <div v-else class="card" aria-busy="true">
      <div class="skeleton" />
      <div class="skeleton w-1/2" />
    </div>

    <StatusMessage
      v-if="rateChangedTo !== null"
      tone="warn"
      :text="t('review.rateChanged', { amount: fiatDisplay(rateChangedTo, currency) })"
    />
    <StatusMessage
      v-if="message"
      :tone="message.tone"
      :text="message.text"
      :support-ref="message.ref"
    />
    <p v-if="quote" class="text-sm text-neutral-800 px-1">
      {{ t('review.signNote', { amount: usdtDisplay(BigInt(quote.youSendUnits)) }) }}
    </p>

    <BottomAction>
      <p v-if="quote" class="text-sm text-center text-neutral-800" aria-live="off">
        {{
          secondsLeft > 0 ? t('review.validFor', { seconds: secondsLeft }) : t('review.refreshing')
        }}
      </p>
      <button
        v-if="rateChangedTo !== null"
        type="button"
        class="btn-primary"
        @click="acceptNewRate"
      >
        {{ t('review.acceptNewRate') }}
      </button>
      <button
        v-else
        type="button"
        class="btn-primary"
        :disabled="!quote || phase !== 'idle' || secondsLeft === 0"
        @click="confirmAndSign"
      >
        {{ busyLabel ?? t('review.confirm') }}
      </button>
    </BottomAction>
  </main>
</template>
