<script setup lang="ts">
import {
  DEFAULT_LIMITS,
  formatUsdt,
  maxAmountForBalance,
  parseUnits,
  usdtToFiatMinor,
  USDT_DECIMALS,
} from '@ferry/shared'
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import Monogram from '../../components/Monogram.vue'
import { useQuote } from '../../composables/useQuote'
import { COUNTRY_NAMES, currencySymbol } from '../../lib/corridors'
import { fiatDisplay, rateDisplay, usdtDisplay } from '../../lib/format'
import { titleCase } from '../../lib/names'
import { useCashoutStore } from '../../stores/cashout'
import { useSessionStore } from '../../stores/session'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()
const session = useSessionStore()

const currency = computed(() => draft.currency!)
const symbol = computed(() => currencySymbol(currency.value))
const { quote, loading, error } = useQuote(
  toRef(draft, 'currency'),
  toRef(draft, 'amountInput'),
  toRef(draft, 'amountIn'),
)
const limits = computed(() => session.meta?.limits ?? DEFAULT_LIMITS)
const feeBps = computed(() => session.meta?.fees.ferryFeeBps ?? 50)
const feePct = computed(() => (feeBps.value / 100).toString())

/** Thousands separators while typing; the store keeps the plain decimal string. */
const display = computed(() => {
  const [whole = '', frac] = draft.amountInput.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac !== undefined ? `${grouped}.${frac}` : grouped
})
const fontSize = computed(() =>
  display.value.length > 9 ? '36px' : display.value.length > 7 ? '40px' : '44px',
)

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = raw.split('.')
  const maxDecimals = draft.amountIn === 'usdt' ? USDT_DECIMALS : 2
  const cleanWhole = whole.replace(/^0+(?=\d)/, '').slice(0, 12)
  draft.amountInput = rest.length
    ? `${cleanWhole || '0'}.${rest.join('').slice(0, maxDecimals)}`
    : cleanWhole
}

function setMode(mode: 'fiat' | 'usdt') {
  if (draft.amountIn === mode) return
  // Carry the equivalent amount across so nothing typed is lost.
  const q = quote.value
  draft.amountIn = mode
  draft.amountInput = q
    ? mode === 'usdt'
      ? formatUsdt(BigInt(q.amountUnits))
      : (BigInt(q.theyReceiveMinor) / 100n).toString()
    : ''
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

const maxUnits = computed(() => parseUnits(limits.value.maxUsd, USDT_DECIMALS))
const minUnits = computed(() => parseUnits(limits.value.minUsd, USDT_DECIMALS))
function useMax() {
  if (!session.balances) return
  const max = maxAmountForBalance(session.balances.usdt, feeBps.value)
  draft.amountIn = 'usdt'
  draft.amountInput = formatUsdt(max < maxUnits.value ? max : maxUnits.value)
}

type Msg = { tone: 'danger' | 'warning'; text: string }
const message = computed<Msg | null>(() => {
  if (error.value) {
    if (error.value.code === 'CORRIDOR_PAUSED')
      return {
        tone: 'warning',
        text: t('amount.paused', { country: COUNTRY_NAMES[currency.value] }),
      }
    if (error.value.code === 'OFFLINE') return { tone: 'danger', text: t('errors.offline') }
    return { tone: 'warning', text: t('amount.noRate') }
  }
  const q = quote.value
  if (!q) return null
  const units = BigInt(q.amountUnits)
  if (units > maxUnits.value) {
    return {
      tone: 'warning',
      text: t('amount.outsideLimits', {
        min: limits.value.minUsd,
        maxUsd: limits.value.maxUsd,
        maxFiat: fiatDisplay(usdtToFiatMinor(maxUnits.value, q.rate), currency.value),
      }),
    }
  }
  if (units < minUnits.value)
    return { tone: 'warning', text: t('amount.belowMin', { min: limits.value.minUsd }) }
  if (session.balances && BigInt(q.youSendUnits) > session.balances.usdt) {
    const canSend = maxAmountForBalance(session.balances.usdt, feeBps.value)
    return {
      tone: 'danger',
      text: t('amount.notEnough', {
        balance: usdtDisplay(session.balances.usdt),
        max: fiatDisplay(usdtToFiatMinor(canSend, q.rate), currency.value),
      }),
    }
  }
  return null
})

const canReview = computed(
  () =>
    !!quote.value && !loading.value && !message.value && !!session.evmAddress && !!session.balances,
)
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/cashout/confirm">
      <Monogram :name="draft.institution!.name" :seed="draft.institution!.code" size="xs" />
      <span style="color: var(--fy-ink)">{{
        t('amount.header', { name: titleCase(draft.accountName ?? '') })
      }}</span>
    </AppHeader>

    <div class="fy-content" style="gap: 18px">
      <div class="fy-seg" role="radiogroup" :aria-label="t('amount.modeLabel')">
        <button
          type="button"
          role="radio"
          :aria-checked="draft.amountIn === 'fiat'"
          @click="setMode('fiat')"
        >
          {{ t('amount.toggleFiat', { symbol }) }}
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="draft.amountIn === 'usdt'"
          @click="setMode('usdt')"
        >
          {{ t('amount.toggleUsdt') }}
        </button>
      </div>

      <div class="flex flex-col items-center gap-2.5" style="padding: 10px 0 4px">
        <label
          for="amount-input"
          style="font: 600 14px var(--fy-font-body); color: var(--fy-ink-2)"
        >
          {{ draft.amountIn === 'fiat' ? t('amount.theyReceive') : t('amount.youSend') }}
        </label>
        <div class="fy-amount-input" :style="{ fontSize }">
          <span v-if="draft.amountIn === 'fiat'" aria-hidden="true">{{ symbol }}</span>
          <span class="fy-amount-input__box">
            <span class="fy-amount-input__mirror" aria-hidden="true">{{ display || '0' }}</span>
            <input
              id="amount-input"
              :value="display"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
              aria-describedby="amount-conv"
              @input="onInput"
            />
          </span>
          <span v-if="draft.amountIn === 'usdt'" class="fy-amount-input__unit">USDT</span>
        </div>
        <span id="amount-conv" aria-live="polite">
          <span v-if="quote" class="fy-pill">
            <Icon name="swap" :size="16" />
            {{
              draft.amountIn === 'fiat'
                ? t('amount.convFiat', { amount: usdtDisplay(BigInt(quote.youSendUnits)) })
                : t('amount.convUsdt', { amount: fiatDisplay(quote.theyReceiveMinor, currency) })
            }}
          </span>
          <span
            v-else-if="loading || error"
            class="fy-skel fy-skel--shimmer"
            style="width: 180px; height: 36px; border-radius: 999px"
          />
        </span>
      </div>

      <dl class="fy-panel">
        <div class="fy-row">
          <dt class="fy-row__k">{{ t('amount.rate') }}</dt>
          <dd class="fy-row__v">
            <template v-if="quote">{{ rateDisplay(quote.rate, currency) }}</template>
            <span v-else class="fy-skel" style="width: 120px; height: 14px" />
          </dd>
        </div>
        <div class="fy-row">
          <dt class="fy-row__k">{{ t('amount.fee', { pct: feePct }) }}</dt>
          <dd class="fy-row__v">{{ t('amount.feeIncluded') }}</dd>
        </div>
        <div class="fy-row" style="min-height: 52px; padding-right: 8px">
          <template v-if="session.evmAddress && session.balances">
            <dt class="fy-row__k">
              {{ t('amount.balance', { amount: usdtDisplay(session.balances.usdt) }) }}
            </dt>
            <dd>
              <button type="button" class="fy-chipbtn" @click="useMax">
                {{ t('amount.useMax') }}
              </button>
            </dd>
          </template>
          <template v-else>
            <dt class="fy-row__k">{{ t('amount.connectRow') }}</dt>
            <dd>
              <button type="button" class="fy-chipbtn" :disabled="connectBusy" @click="connect">
                {{ connectBusy ? '…' : t('amount.connect') }}
              </button>
            </dd>
          </template>
        </div>
      </dl>

      <span class="fy-caption text-center">
        {{ t('amount.limits', { min: limits.minUsd, max: limits.maxUsd, daily: limits.dailyUsd }) }}
      </span>

      <p
        v-if="message"
        class="fy-inline-msg"
        :style="{ color: message.tone === 'danger' ? 'var(--fy-danger)' : 'var(--fy-warning)' }"
        role="status"
      >
        <Icon :name="message.tone === 'danger' ? 'alert' : 'info'" :size="18" :stroke="2.2" />{{
          message.text
        }}
      </p>
      <Banner v-if="connectMsg" tone="brand" :body="connectMsg" />
      <Banner
        v-if="session.evmAddress && session.balancesError"
        tone="danger"
        :body="t('evm.balanceFailed')"
        :action="t('common.tryAgain')"
        @action="session.loadBalances().catch(() => {})"
      />
    </div>

    <div class="fy-bottom">
      <button
        type="button"
        class="fy-btn fy-btn--primary"
        :disabled="!canReview"
        @click="router.push('/cashout/review')"
      >
        {{ t('amount.review') }}
      </button>
    </div>
  </main>
</template>
