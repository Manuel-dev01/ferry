<script setup lang="ts">
import {
  DEFAULT_LIMITS,
  formatUsdt,
  maxAmountForBalance,
  parseUnits,
  USDT_DECIMALS,
} from '@ferry/shared'
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import BottomAction from '../../components/BottomAction.vue'
import StatusMessage from '../../components/StatusMessage.vue'
import TopBar from '../../components/TopBar.vue'
import { useQuote } from '../../composables/useQuote'
import { fiatDisplay, rateDisplay, usdtDisplay } from '../../lib/format'
import { useCashoutStore } from '../../stores/cashout'
import { useSessionStore } from '../../stores/session'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()

const currency = computed(() => draft.currency!)
const { quote, loading, error } = useQuote(
  toRef(draft, 'currency'),
  toRef(draft, 'amountInput'),
  toRef(draft, 'amountIn'),
)

const limits = computed(() => session.meta?.limits ?? DEFAULT_LIMITS)
const feeBps = computed(() => session.meta?.fees.ferryFeeBps ?? 50)
const symbol = computed(
  () =>
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.value,
      currencyDisplay: 'narrowSymbol',
    })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency.value,
)

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/,/g, '').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = raw.split('.')
  const maxDecimals = draft.amountIn === 'usdt' ? USDT_DECIMALS : 2
  draft.amountInput = rest.length ? `${whole}.${rest.join('').slice(0, maxDecimals)}` : whole
}

function toggle() {
  // Carry the equivalent amount across so the user doesn't lose what they typed.
  const q = quote.value
  if (draft.amountIn === 'fiat') {
    draft.amountIn = 'usdt'
    draft.amountInput = q ? formatUsdt(BigInt(q.amountUnits)) : ''
  } else {
    draft.amountIn = 'fiat'
    draft.amountInput = q ? (BigInt(q.theyReceiveMinor) / 100n).toString() : ''
  }
}

const connectBusy = ref(false)
const connectMsg = ref<string | null>(null)
async function connect() {
  connectBusy.value = true
  connectMsg.value = null
  const result = await session.connectEvm()
  connectBusy.value = false
  if (result === 'rejected') connectMsg.value = t('evm.rejected')
  else if (result === 'unavailable') connectMsg.value = t('evm.unavailable')
  else if (result !== 'ok') connectMsg.value = t('errors.generic')
}

function useMax() {
  if (!session.balances) return
  const cap = parseUnits(limits.value.maxUsd, USDT_DECIMALS)
  const max = maxAmountForBalance(session.balances.usdt, feeBps.value)
  draft.amountIn = 'usdt'
  draft.amountInput = formatUsdt(max < cap ? max : cap)
}

const outsideLimits = computed(() => {
  if (!quote.value) return false
  const units = BigInt(quote.value.amountUnits)
  return (
    units < parseUnits(limits.value.minUsd, USDT_DECIMALS) ||
    units > parseUnits(limits.value.maxUsd, USDT_DECIMALS)
  )
})
const notEnough = computed(
  () =>
    !!quote.value && !!session.balances && BigInt(quote.value.youSendUnits) > session.balances.usdt,
)
const canContinue = computed(
  () =>
    !!quote.value &&
    !loading.value &&
    !outsideLimits.value &&
    !!session.evmAddress &&
    !!session.balances &&
    !notEnough.value,
)

const quoteErrorText = computed(() => {
  if (!error.value) return null
  if (error.value.code === 'CORRIDOR_PAUSED')
    return t('amount.paused', { country: draft.corridor()?.name ?? '' })
  if (error.value.code === 'OFFLINE') return t('errors.offline')
  return t('amount.quoteFailed')
})
</script>

<template>
  <main class="page">
    <TopBar :title="t('amount.title')" :step="4" :steps="5" back="/cashout/confirm" />

    <section class="card">
      <label class="label" for="amount-input">
        {{ draft.amountIn === 'fiat' ? t('amount.theyReceive') : t('amount.youSend') }}
      </label>
      <div class="amount-field">
        <span class="text-2xl font-bold text-neutral-700" aria-hidden="true">
          {{ draft.amountIn === 'fiat' ? symbol : '' }}
        </span>
        <input
          id="amount-input"
          class="amount-input"
          :value="draft.amountInput"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0"
          :aria-describedby="'amount-help'"
          @input="onInput"
        />
        <span v-if="draft.amountIn === 'usdt'" class="text-lg font-bold text-neutral-700"
          >USDT</span
        >
      </div>

      <p id="amount-help" class="mt-2 min-h-6 text-neutral-900" aria-live="polite">
        <template v-if="quote">
          <template v-if="draft.amountIn === 'fiat'">
            {{ t('amount.youSend') }}:
            <strong>{{ usdtDisplay(BigInt(quote.youSendUnits)) }} USDT</strong>
          </template>
          <template v-else>
            {{ t('amount.theyReceive') }}:
            <strong>{{ fiatDisplay(quote.theyReceiveMinor, currency) }}</strong>
          </template>
        </template>
        <span v-else-if="loading" class="text-neutral-700">…</span>
      </p>

      <button type="button" class="btn-ghost mt-2" @click="toggle">
        <span class="i-nimiq:exchange-chevron" aria-hidden="true" />
        {{
          draft.amountIn === 'fiat' ? t('amount.toggleUsdt') : t('amount.toggleFiat', { currency })
        }}
      </button>
    </section>

    <section v-if="quote" class="card">
      <dl>
        <div class="row">
          <dt class="row-label">{{ t('amount.rate') }}</dt>
          <dd class="row-value">{{ rateDisplay(quote.rate, currency) }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">{{ t('amount.fee') }}</dt>
          <dd class="row-value">{{ usdtDisplay(BigInt(quote.ferryFeeUnits)) }} USDT</dd>
        </div>
      </dl>
    </section>

    <StatusMessage
      v-if="quoteErrorText"
      tone="error"
      :text="quoteErrorText"
      :support-ref="error?.ref"
    />
    <StatusMessage
      v-else-if="outsideLimits"
      tone="warn"
      :text="t('amount.outsideLimits', { min: limits.minUsd, max: limits.maxUsd })"
    />
    <StatusMessage
      v-else-if="notEnough && session.balances"
      tone="warn"
      :text="t('amount.notEnough', { balance: usdtDisplay(session.balances.usdt) })"
    />
    <p v-else class="text-sm text-neutral-800 px-1 mb-3">
      {{ t('amount.limits', { min: limits.minUsd, max: limits.maxUsd, daily: limits.dailyUsd }) }}
    </p>

    <BottomAction>
      <div
        v-if="session.evmAddress && session.balances"
        class="flex items-center justify-between text-sm"
      >
        <span>{{ t('amount.balance', { amount: usdtDisplay(session.balances.usdt) }) }}</span>
        <button type="button" class="link font-semibold" @click="useMax">
          {{ t('amount.useMax') }}
        </button>
      </div>
      <template v-if="session.evmAddress && session.balancesError">
        <p class="text-sm text-red-1100" role="alert">{{ t('evm.balanceFailed') }}</p>
        <button type="button" class="btn-secondary" @click="session.loadBalances().catch(() => {})">
          {{ t('common.tryAgain') }}
        </button>
      </template>
      <template v-if="!session.evmAddress">
        <p class="text-sm text-neutral-800">{{ t('amount.connectToContinue') }}</p>
        <p v-if="connectMsg" class="text-sm text-neutral-900" role="status">{{ connectMsg }}</p>
        <button type="button" class="btn-primary" :disabled="connectBusy" @click="connect">
          {{ connectBusy ? t('evm.connecting') : t('evm.connect') }}
        </button>
      </template>
      <button
        v-else
        type="button"
        class="btn-primary"
        :disabled="!canContinue"
        @click="router.push('/cashout/review')"
      >
        {{ t('common.continue') }}
      </button>
    </BottomAction>
  </main>
</template>
