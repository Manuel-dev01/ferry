<script setup lang="ts">
import {
  isOfframpStatus,
  isTerminal,
  TRACKER_STEPS,
  trackerStepFor,
  type OrderView,
  type TrackerStep,
} from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BottomAction from '../components/BottomAction.vue'
import StatusMessage from '../components/StatusMessage.vue'
import TopBar from '../components/TopBar.vue'
import { useNow } from '../composables/useNow'
import { errorCode } from '../lib/api'
import { ferryApi } from '../lib/ferryApi'
import {
  durationDisplay,
  fiatDisplay,
  polygonscanTx,
  timeDisplay,
  usdtDisplay,
} from '../lib/format'
import { useHistoryStore } from '../stores/history'

const POLL_MS = 2_500
const SLOW_MS = 2 * 60_000

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const history = useHistoryStore()
const now = useNow()

const entry = computed(() => history.find(props.id))
const order = ref<OrderView | null>(null)
const offline = ref(false)
const gone = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function poll() {
  const e = entry.value
  if (!e) return
  try {
    order.value = await ferryApi.order(e.id, e.clientSecret)
    history.updateFrom(order.value)
    offline.value = false
  } catch (err) {
    if (errorCode(err) === 'ORDER_NOT_FOUND') {
      gone.value = true // e.g. the dev API restarted and lost its in-memory mock orders
      return
    }
    offline.value = true // a failed read is not an outcome; keep checking
  }
  const s = order.value?.status
  if (!s || !isOfframpStatus(s) || !isTerminal(s)) timer = setTimeout(() => void poll(), POLL_MS)
}
onMounted(() => void poll())
onUnmounted(() => clearTimeout(timer))

const status = computed(() => order.value?.status ?? entry.value?.status ?? 'submitted')
const currentStep = computed<TrackerStep | null>(() =>
  isOfframpStatus(status.value) ? trackerStepFor(status.value) : null,
)

/** When each tracker step was first reached, from the order's timeline. */
const stepTimes = computed(() => {
  const times: Partial<Record<TrackerStep, number>> = {}
  for (const entry of order.value?.timeline ?? []) {
    if (!isOfframpStatus(entry.status)) continue
    const step = trackerStepFor(entry.status)
    if (step && times[step] === undefined) times[step] = entry.at
  }
  return times
})

const stepState = (step: TrackerStep) => {
  const idx = TRACKER_STEPS.indexOf(step)
  const cur = currentStep.value ? TRACKER_STEPS.indexOf(currentStep.value) : -1
  if (status.value === 'settled' || idx < cur) return 'done'
  if (idx === cur) return step === 'paid' ? 'done' : 'active'
  return 'todo'
}

const terminal = computed(() => isOfframpStatus(status.value) && isTerminal(status.value))

const sentAt = computed(() => stepTimes.value.sent ?? order.value?.createdAt ?? now.value)
const slow = computed(() => !!order.value && !terminal.value && now.value - sentAt.value > SLOW_MS)
const tookMs = computed(() =>
  order.value?.settledAt ? order.value.settledAt - sentAt.value : now.value - sentAt.value,
)

const amountText = computed(() =>
  order.value ? fiatDisplay(order.value.theyReceiveMinor, order.value.currency) : '',
)
const recipientText = computed(() =>
  entry.value
    ? `${entry.value.recipientName ?? ''} · ${entry.value.institutionName} ${entry.value.recipientMasked}`.trim()
    : '',
)

const copied = ref(false)
async function copyId() {
  try {
    await navigator.clipboard.writeText(props.id)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard unavailable over plain http on LAN; the ID is still visible and selectable
  }
}

async function share() {
  const text = t('receipt.shareText', {
    amount: amountText.value,
    duration: durationDisplay(tookMs.value),
  })
  try {
    if (navigator.share) await navigator.share({ title: 'Ferry', text })
    else await navigator.clipboard.writeText(text)
  } catch {
    // user closed the share sheet
  }
}
</script>

<template>
  <main class="page">
    <TopBar :title="status === 'settled' ? t('receipt.title') : t('tracker.title')" back="/" />

    <section v-if="!entry || gone" class="card text-center">
      <p class="muted mb-4">{{ t('tracker.notFound') }}</p>
      <RouterLink to="/" class="btn-secondary">{{ t('tracker.startAgain') }}</RouterLink>
    </section>

    <template v-else>
      <StatusMessage v-if="offline" tone="warn" :text="t('tracker.offline')" />
      <StatusMessage v-if="order?.mock" tone="info" :text="t('tracker.mockNote')" />

      <!-- Receipt -->
      <section v-if="status === 'settled' && order" class="card text-center py-6 receipt">
        <span class="i-nimiq:check text-4xl text-green-1100 inline-block mb-2" aria-hidden="true" />
        <p class="text-4xl font-bold">{{ amountText }}</p>
        <p class="mt-1">{{ t('receipt.sentTo', { name: recipientText }) }}</p>
        <p class="text-sm text-neutral-800 mt-1">
          {{ t('receipt.took', { duration: durationDisplay(tookMs) }) }}
        </p>
        <dl class="text-left mt-5">
          <div class="row">
            <dt class="row-label">{{ t('review.youSend') }}</dt>
            <dd class="row-value">{{ usdtDisplay(BigInt(order.amountToTransferUnits)) }} USDT</dd>
          </div>
          <div class="row">
            <dt class="row-label">{{ t('receipt.orderId') }}</dt>
            <dd class="row-value">
              <button type="button" class="link font-mono text-sm" @click="copyId">
                {{ copied ? t('common.copied') : props.id }}
              </button>
            </dd>
          </div>
          <div v-if="order.polygonTxHash && !order.mock" class="row">
            <dt class="row-label">{{ t('receipt.tx') }}</dt>
            <dd class="row-value">
              <a
                class="link"
                :href="polygonscanTx(order.polygonTxHash)"
                target="_blank"
                rel="noopener"
              >
                {{ t('receipt.viewTx') }}
              </a>
            </dd>
          </div>
        </dl>
        <p class="text-xs text-neutral-700 mt-4">{{ t('receipt.sentWith') }}</p>
      </section>

      <!-- Terminal failures -->
      <section v-else-if="status === 'refunded' && order" class="card">
        <StatusMessage
          tone="warn"
          :text="
            t('tracker.refunded', { amount: usdtDisplay(BigInt(order.amountToTransferUnits)) })
          "
        />
      </section>
      <section v-else-if="status === 'expired' || status === 'failed'" class="card">
        <StatusMessage
          tone="info"
          :text="status === 'expired' ? t('tracker.expired') : t('tracker.failed')"
        />
      </section>

      <!-- Live tracker -->
      <section v-else class="card">
        <p class="text-sm font-semibold text-neutral-800">{{ t('review.theyReceive') }}</p>
        <p class="text-3xl font-bold mb-1">{{ amountText || '…' }}</p>
        <p class="text-sm text-neutral-800 mb-5">{{ recipientText }}</p>
        <ol class="tracker" aria-live="polite">
          <li
            v-for="step in TRACKER_STEPS"
            :key="step"
            class="tracker-step"
            :class="`tracker-${stepState(step)}`"
          >
            <span class="tracker-dot" aria-hidden="true">
              <span v-if="stepState(step) === 'done'" class="i-nimiq:check text-xs" />
            </span>
            <span class="flex-1">
              <span class="block font-semibold">{{ t(`tracker.steps.${step}`) }}</span>
              <span v-if="stepTimes[step]" class="block text-xs text-neutral-700">
                {{ timeDisplay(stepTimes[step]!) }}
              </span>
            </span>
          </li>
        </ol>
        <StatusMessage
          v-if="status === 'compliance_hold'"
          class="mt-4"
          tone="warn"
          :text="t('tracker.hold')"
        />
        <StatusMessage
          v-else-if="status === 'unknown'"
          class="mt-4"
          tone="warn"
          :text="t('tracker.unknown')"
        />
        <StatusMessage v-else-if="slow" class="mt-4" tone="warn" :text="t('tracker.slow')" />
        <p v-else class="text-sm text-neutral-800 mt-4">{{ t('tracker.eta') }}</p>
      </section>
    </template>

    <BottomAction v-if="entry && !gone && terminal">
      <button v-if="status === 'settled'" type="button" class="btn-secondary" @click="share">
        {{ t('receipt.share') }}
      </button>
      <RouterLink to="/" class="btn-primary">{{ t('common.done') }}</RouterLink>
    </BottomAction>
  </main>
</template>
