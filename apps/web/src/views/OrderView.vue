<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Banner, { type BannerTone } from '../components/Banner.vue'
import DealScreen from '../components/DealScreen.vue'
import FerryLogo from '../components/FerryLogo.vue'
import Icon from '../components/Icon.vue'
import { SUPPORT_URL } from '../config'
import { useNow } from '../composables/useNow'
import { useOrder } from '../composables/useOrder'
import { durationDisplay, fiatDisplay, timeDisplay, usdtDisplay } from '../lib/format'
import { orderRef, tinyAddress, titleCase } from '../lib/names'

const ETA_MS = 45_000
const SLOW_MS = 2 * 60_000

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const router = useRouter()
const now = useNow()
const { entry, order, status, at, offline, gone, lastUpdate } = useOrder(() => props.id)

const name = computed(() => titleCase(entry.value?.recipientName ?? ''))
const amountText = computed(() =>
  entry.value
    ? fiatDisplay(
        order.value?.theyReceiveMinor ?? entry.value.theyReceiveMinor,
        entry.value.currency,
      )
    : '',
)
const usdt = computed(() =>
  order.value ? usdtDisplay(BigInt(order.value.amountToTransferUnits)) : '',
)
const toLine = computed(() =>
  entry.value
    ? t('tracker.to', {
        name: name.value || entry.value.institutionName,
        institution: entry.value.institutionName,
        masked: entry.value.recipientMasked,
      })
    : '',
)

const sentAt = computed(
  () => at.value.submitted ?? at.value.signed ?? order.value?.createdAt ?? now.value,
)
const elapsed = computed(() => now.value - sentAt.value)
const time = (ms: number | undefined) => (ms ? timeDisplay(ms) : '')

type StepState = 'done' | 'now' | 'next'
interface Step {
  label: string
  time: string
  state: StepState
}
interface NowCard {
  tone: 'brand' | 'warning' | 'mint'
  eyebrow: string
  title: string
  eta: string
  pct: number
}
interface TrackerView {
  statusLabel: string
  steps: Step[]
  now: NowCard
  note: { tone: BannerTone; text: string }
}

const view = computed<TrackerView>(() => {
  const s = status.value
  const safe = {
    tone: 'success' as BannerTone,
    text: t('tracker.noteSafe', { amount: usdt.value || '…' }),
  }
  const nowEyebrow = offline.value
    ? t('tracker.lastUpdate', { time: time(lastUpdate.value ?? undefined) })
    : t('tracker.now', { time: timeDisplay(now.value) })
  const left = Math.ceil((ETA_MS - elapsed.value) / 1000)
  const eta = offline.value
    ? t('tracker.offline')
    : left > 3
      ? t('tracker.etaLeft', { s: left })
      : t('tracker.etaSoon')
  const paidEta = `≈ ${timeDisplay(sentAt.value + ETA_MS)}`
  const done = (label: string, ms?: number): Step => ({ label, time: time(ms), state: 'done' })
  const next = (label: string, timeText = ''): Step => ({ label, time: timeText, state: 'next' })
  const nowStep = (label: string): Step => ({ label, time: '', state: 'now' })
  const offlineNote = { tone: 'neutral' as BannerTone, text: t('tracker.noteOffline') }

  if (s === 'unknown') {
    return {
      statusLabel: t('tracker.status.checking'),
      steps: [
        nowStep(t('tracker.steps.checking')),
        next(t('tracker.steps.received')),
        next(t('tracker.steps.payingDone')),
        next(t('tracker.steps.paid')),
      ],
      now: {
        tone: 'brand',
        eyebrow: nowEyebrow,
        title: t('tracker.steps.checking'),
        eta: t('tracker.etaFew'),
        pct: 25,
      },
      note: { tone: 'brand', text: t('tracker.noteChecking') },
    }
  }
  if (s === 'settled') {
    const took = durationDisplay((order.value?.settledAt ?? now.value) - sentAt.value)
    return {
      statusLabel: t('tracker.status.paid'),
      steps: [
        done(t('tracker.steps.sent'), sentAt.value),
        done(t('tracker.steps.received'), at.value.deposited),
        done(t('tracker.steps.payingDone'), at.value.pending ?? at.value.validated),
        nowStep(t('tracker.steps.paid')),
      ],
      now: {
        tone: 'mint',
        eyebrow: t('tracker.paidAt', { time: time(at.value.settled) }),
        title: t('tracker.paidIn', { duration: took }),
        eta: '✓',
        pct: 100,
      },
      note: {
        tone: 'success',
        text: t('tracker.notePaid', {
          amount: amountText.value,
          name: name.value || entry.value?.institutionName || '',
        }),
      },
    }
  }
  if (s === 'deposited' || s === 'pending' || s === 'validated' || s === 'compliance_hold') {
    const review = s === 'compliance_hold'
    const slow = !review && elapsed.value > SLOW_MS
    const title = review
      ? t('tracker.steps.review')
      : slow
        ? t('tracker.steps.slow')
        : t('tracker.steps.paying')
    return {
      statusLabel: review ? t('tracker.status.review') : t('tracker.status.paying'),
      steps: [
        done(t('tracker.steps.sent'), sentAt.value),
        done(t('tracker.steps.received'), at.value.deposited),
        nowStep(title),
        next(t('tracker.steps.paid'), review || slow ? '' : paidEta),
      ],
      now: {
        tone: review || slow ? 'warning' : 'brand',
        eyebrow: review ? t('tracker.since', { time: time(at.value.compliance_hold) }) : nowEyebrow,
        title,
        eta: review ? t('tracker.eta24') : slow ? t('tracker.etaUsually') : eta,
        pct: review ? 70 : slow ? 75 : s === 'validated' ? 85 : 60,
      },
      note: offline.value
        ? offlineNote
        : review
          ? { tone: 'warning', text: t('tracker.noteReview', { amount: usdt.value }) }
          : slow
            ? { tone: 'warning', text: t('tracker.noteSlow') }
            : safe,
    }
  }
  // submitted (or signed): the USDT is on its way to the payout partner
  return {
    statusLabel: t('tracker.status.sending'),
    steps: [
      done(t('tracker.steps.sent'), sentAt.value),
      nowStep(t('tracker.steps.received')),
      next(t('tracker.steps.payingDone')),
      next(t('tracker.steps.paid'), paidEta),
    ],
    now: { tone: 'brand', eyebrow: nowEyebrow, title: t('tracker.steps.received'), eta, pct: 35 },
    note: offline.value ? offlineNote : safe,
  }
})

const refCode = computed(() => orderRef(props.id))
const refundedAddress = computed(() => (order.value ? tinyAddress(order.value.refundAddress) : ''))
</script>

<template>
  <!-- Not on this device (or the dev API forgot it) -->
  <DealScreen
    v-if="!entry || gone"
    color="surface"
    :eyebrow="refCode"
    :title="t('tracker.notFound')"
    :heading="t('tracker.startAgain')"
    :body="t('history.emptyBody')"
    :primary="t('common.backHome')"
    @primary="router.push('/')"
  />

  <!-- 11 · Outcomes -->
  <DealScreen
    v-else-if="status === 'refunded'"
    color="cream"
    :eyebrow="t('outcome.refundedEyebrow', { time: timeDisplay(at.refunded ?? now) })"
    :title="t('outcome.refundedTitle', { amount: usdt })"
    :sub="t('outcome.refundedSub', { address: refundedAddress })"
    :heading="t('outcome.refundedHeading')"
    :body="t('outcome.refundedBody', { institution: entry.institutionName })"
    :rows="[
      { k: t('outcome.ref'), v: refCode },
      { k: t('outcome.refundedTo'), v: refundedAddress },
    ]"
    :primary="t('common.tryAgain')"
    :secondary="t('common.backHome')"
    @primary="router.push('/cashout')"
    @secondary="router.push('/')"
  />
  <DealScreen
    v-else-if="status === 'expired'"
    color="surface"
    :eyebrow="t('outcome.expiredEyebrow')"
    :title="t('outcome.expiredTitle')"
    :sub="t('outcome.expiredSub')"
    :heading="t('outcome.expiredHeading')"
    :body="t('outcome.expiredBody')"
    :primary="t('outcome.newQuote')"
    :secondary="t('common.backHome')"
    @primary="router.push('/cashout')"
    @secondary="router.push('/')"
  />
  <DealScreen
    v-else-if="status === 'failed'"
    color="danger"
    :eyebrow="t('outcome.failedEyebrow')"
    :title="t('outcome.failedTitle')"
    :sub="t('outcome.failedSub', { amount: usdt })"
    :heading="t('outcome.failedHeading', { name: name || entry.institutionName })"
    :body="t('outcome.failedBody')"
    :rows="[
      { k: t('outcome.ref'), v: refCode },
      { k: t('outcome.status'), v: t('outcome.refundInProgress') },
    ]"
    :primary="t('outcome.support')"
    :primary-href="SUPPORT_URL"
    :secondary="t('common.backHome')"
    @secondary="router.push('/')"
  />

  <!-- 09 · Live tracker -->
  <main v-else class="fy-screen">
    <header class="fy-header" style="padding: 0 20px">
      <RouterLink
        to="/"
        :aria-label="t('common.backHome')"
        style="color: inherit; text-decoration: none"
      >
        <FerryLogo :mark="false" />
      </RouterLink>
      <span class="fy-caption">{{ t('errors.ref', { ref: refCode }) }}</span>
    </header>

    <div class="fy-content" style="gap: 18px">
      <div class="flex flex-col gap-1.5">
        <span style="font: 700 14px var(--fy-font-body); color: var(--fy-brand-text)">{{
          view.statusLabel
        }}</span>
        <span class="fy-amount" style="font-size: 38px">{{ amountText }}</span>
        <span style="font-size: 14.5px; color: var(--fy-ink-2)">{{ toLine }}</span>
      </div>

      <ol class="fy-steps" aria-live="polite" style="margin: 0; padding: 0; list-style: none">
        <template v-for="(step, i) in view.steps" :key="i">
          <li
            v-if="step.state === 'now'"
            class="fy-now"
            :class="`fy-now--${view.now.tone}`"
            aria-current="step"
          >
            <div class="fy-now__top">
              <span class="fy-eyebrow">{{ view.now.eyebrow }}</span>
              <span>{{ view.now.eta }}</span>
            </div>
            <span class="fy-now__title">{{ view.now.title }}</span>
            <span class="fy-now__track"
              ><span class="fy-now__bar" :style="{ width: `${view.now.pct}%` }"
            /></span>
          </li>
          <li v-else class="fy-step" :class="`fy-step--${step.state}`">
            <span class="fy-step__dot"
              ><Icon v-if="step.state === 'done'" name="check" :size="14" :stroke="3"
            /></span>
            <span class="fy-step__label">{{ step.label }}</span>
            <span class="fy-step__time">{{ step.time }}</span>
          </li>
        </template>
      </ol>

      <Banner :tone="view.note.tone" icon="shield" :body="view.note.text" />
      <p v-if="order?.mock" class="fy-caption">{{ t('tracker.mockNote') }}</p>
    </div>

    <div class="fy-bottom">
      <RouterLink
        v-if="status === 'settled'"
        :to="`/orders/${id}/receipt`"
        class="fy-btn fy-btn--primary"
      >
        {{ t('tracker.seeReceipt') }}
      </RouterLink>
      <RouterLink v-else to="/" class="fy-btn fy-btn--secondary">{{
        t('common.backHome')
      }}</RouterLink>
    </div>
  </main>
</template>
