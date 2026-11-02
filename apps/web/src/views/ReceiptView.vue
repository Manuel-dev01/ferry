<script setup lang="ts">
import { isCorridorCurrency } from '@ferry/shared'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '../components/AppHeader.vue'
import DealCard from '../components/DealCard.vue'
import Icon from '../components/Icon.vue'
import { useOrder } from '../composables/useOrder'
import { COUNTRY_NAMES, FLAGS } from '../lib/corridors'
import {
  dateTimeDisplay,
  durationDisplay,
  fiatDisplay,
  polygonscanTx,
  rateDisplay,
  timeDisplay,
  usdtDisplay,
} from '../lib/format'
import { orderRef } from '../lib/names'
import { renderShareImage } from '../lib/shareImage'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const { entry, order, at } = useOrder(() => props.id, false)

const sentAt = computed(() => at.value.submitted ?? order.value?.createdAt ?? 0)
const tookMs = computed(() => (order.value?.settledAt ?? 0) - sentAt.value)
const amount = computed(() =>
  order.value ? fiatDisplay(order.value.theyReceiveMinor, order.value.currency) : '',
)
const paidAt = computed(() =>
  order.value?.settledAt ? dateTimeDisplay(order.value.settledAt) : '',
)
const shortTx = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

const copied = ref(false)
async function copyId() {
  try {
    await navigator.clipboard.writeText(props.id)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard unavailable (plain http on LAN): the ID stays visible
  }
}

const sharing = ref(false)
async function share() {
  if (!order.value) return
  sharing.value = true
  const seconds = durationDisplay(tookMs.value)
  const text = t('receipt.shareText', { amount: amount.value, seconds })
  try {
    const c = order.value.currency
    const blob = await renderShareImage({
      amount: amount.value.replace(/\.00$/, ''),
      eyebrow: `Paid in ${tookMs.value < 60_000 ? `${Math.round(tookMs.value / 1000)} seconds` : seconds}`,
      place: isCorridorCurrency(c) ? `landed in ${COUNTRY_NAMES[c]} ${FLAGS[c]}` : '',
      headline: t('home.title'),
      sub: 'USDT to bank and mobile money · inside Nimiq Pay',
    })
    const file = new File([blob], 'ferry-receipt.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text })
    } else if (navigator.share) {
      await navigator.share({ text })
    } else {
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: 'ferry-receipt.png',
      })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  } catch {
    // the user closed the share sheet
  } finally {
    sharing.value = false
  }
}
</script>

<template>
  <main class="fy-screen">
    <AppHeader :close="`/orders/${id}`" :title="t('receipt.title')" />
    <div class="fy-content" style="padding-top: 12px">
      <template v-if="order && entry">
        <DealCard color="mint" back="cream">
          <div class="flex items-center justify-between gap-2">
            <span class="fy-eyebrow">{{ t('receipt.paidAt', { time: paidAt }) }}</span>
            <span
              class="inline-flex items-center"
              style="
                height: 28px;
                padding: 0 10px;
                border-radius: 999px;
                background: var(--fy-card-ink);
                color: var(--fy-card-mint);
                font: 700 13px var(--fy-font-body);
                white-space: nowrap;
              "
            >
              {{ t('receipt.paidIn', { duration: durationDisplay(tookMs) }) }}
            </span>
          </div>
          <span class="fy-amount" style="font-size: 36px">{{ amount }}</span>
          <span style="font-size: 14.5px; font-weight: 600">
            to {{ entry.recipientName ?? entry.institutionName }} · {{ entry.institutionName }}
            {{ entry.recipientMasked }}
          </span>
        </DealCard>

        <dl class="fy-panel">
          <div class="fy-row" style="min-height: 44px">
            <dt class="fy-row__k">{{ t('receipt.youSent') }}</dt>
            <dd class="fy-row__v" style="font-weight: 600">
              {{ usdtDisplay(BigInt(order.amountToTransferUnits)) }} USDT
            </dd>
          </div>
          <div class="fy-row" style="min-height: 44px">
            <dt class="fy-row__k">{{ t('receipt.rate') }}</dt>
            <dd class="fy-row__v">{{ rateDisplay(order.rate, order.currency) }}</dd>
          </div>
          <div class="fy-row" style="min-height: 44px">
            <dt class="fy-row__k">{{ t('receipt.fees') }}</dt>
            <dd class="fy-row__v">
              {{ t('receipt.feesValue', { fee: usdtDisplay(BigInt(order.ferryFeeUnits)) }) }}
            </dd>
          </div>
          <div class="fy-row" style="min-height: 44px">
            <dt class="fy-row__k">{{ t('receipt.time') }}</dt>
            <dd class="fy-row__v">
              {{
                t('receipt.timeValue', {
                  duration: durationDisplay(tookMs),
                  from: timeDisplay(sentAt),
                  to: timeDisplay(order.settledAt ?? sentAt),
                })
              }}
            </dd>
          </div>
          <div class="fy-row" style="min-height: 48px; padding-right: 6px">
            <dt class="fy-row__k">{{ t('receipt.orderId') }}</dt>
            <dd class="fy-row__v flex items-center gap-1" style="font-weight: 600">
              {{ copied ? t('common.copied') : orderRef(id) }}
              <button
                type="button"
                class="fy-iconbtn"
                style="width: 40px; height: 40px; color: var(--fy-brand-text)"
                :aria-label="t('common.copy')"
                @click="copyId"
              >
                <Icon name="copy" :size="17" />
              </button>
            </dd>
          </div>
          <div class="fy-row" style="min-height: 48px; padding-right: 6px">
            <dt class="fy-row__k">{{ t('receipt.tx') }}</dt>
            <dd
              v-if="order.mock || !order.polygonTxHash"
              class="fy-row__v"
              style="color: var(--fy-ink-2)"
            >
              {{ t('receipt.simulated') }}
            </dd>
            <dd v-else class="fy-row__v">
              <a
                :href="polygonscanTx(order.polygonTxHash)"
                target="_blank"
                rel="noopener"
                class="flex items-center gap-1"
                style="font-weight: 600; text-decoration: none"
              >
                {{ shortTx(order.polygonTxHash) }}
                <span class="fy-iconbtn" style="width: 40px; height: 40px"
                  ><Icon name="external" :size="17"
                /></span>
              </a>
            </dd>
          </div>
        </dl>
      </template>
      <div v-else class="flex flex-col gap-3" aria-busy="true">
        <span class="fy-skel fy-skel--shimmer" style="height: 160px; border-radius: 28px" />
        <span class="fy-skel" style="height: 240px; border-radius: 20px" />
      </div>
    </div>
    <div class="fy-bottom fy-bottom--split">
      <button
        type="button"
        class="fy-btn fy-btn--secondary"
        :disabled="!order || sharing"
        @click="share"
      >
        <Icon name="share" :size="18" />{{ t('receipt.share') }}
      </button>
      <RouterLink to="/" class="fy-btn fy-btn--primary">{{ t('common.done') }}</RouterLink>
    </div>
  </main>
</template>
