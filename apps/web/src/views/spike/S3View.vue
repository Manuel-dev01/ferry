<script setup lang="ts">
import './spike.css'
import { normalizeKenyanPhone, type SpikeLnurlResponse } from '@ferry/shared'
import { computed, onUnmounted, ref } from 'vue'
import StatusMessage from '../../components/StatusMessage.vue'
import StepLog from '../../components/StepLog.vue'
import { useStepLog } from '../../composables/useStepLog'
import { api, ApiRequestError } from '../../lib/api'
import { classifyNimiqError, lightningIdsFrom } from '../../providers/nimiq'
import { useSessionStore } from '../../stores/session'

const VERIFY_POLL_MS = 5_000
const VERIFY_MAX_MS = 5 * 60_000

const session = useSessionStore()
const log = useStepLog()

const address = ref('')
const phone = ref('')
const sats = ref(500)
const invoice = ref<SpikeLnurlResponse | null>(null)
const busy = ref(false)
/** Once the host may have submitted a payment, paying again is disabled for this invoice. */
const payLocked = ref(false)
const settled = ref<boolean | null>(null)
let verifyTimer: ReturnType<typeof setTimeout> | null = null

const now = ref(Math.floor(Date.now() / 1000))
const clock = setInterval(() => (now.value = Math.floor(Date.now() / 1000)), 1000)
onUnmounted(() => {
  clearInterval(clock)
  if (verifyTimer) clearTimeout(verifyTimer)
})
const secondsLeft = computed(() => (invoice.value ? invoice.value.expiresAt - now.value : 0))

const describe = (err: unknown) =>
  err instanceof ApiRequestError
    ? `${err.message} (${err.code}${err.ref ? `, ${err.ref}` : ''})`
    : err instanceof Error
      ? err.message
      : String(err)

function fillFromPhone(form: 'local' | 'international') {
  const normalized = normalizeKenyanPhone(phone.value)
  if (!normalized) {
    log.add('That is not a Kenyan mobile number.', 'warn')
    return
  }
  const user = form === 'local' ? `0${normalized.slice(3)}` : normalized
  address.value = `${user}@bitcoin.co.ke`
}

async function getInvoice() {
  busy.value = true
  invoice.value = null
  payLocked.value = false
  settled.value = null
  try {
    log.add(`Resolving ${address.value} for ${sats.value} sats…`)
    invoice.value = await api<SpikeLnurlResponse>('/spike/lnurl', {
      method: 'POST',
      body: { address: address.value, sats: sats.value },
    })
    const { minSendableMsat, maxSendableMsat } = invoice.value.limits
    log.add(
      `Invoice ready ✓ Accepts ${Number(minSendableMsat) / 1000}–${Number(maxSendableMsat) / 1000} sats. ` +
        `Status URL: ${invoice.value.hasVerify ? 'yes' : 'no'}.`,
      'success',
    )
  } catch (err) {
    log.add(`Could not get an invoice: ${describe(err)}`, 'error')
  } finally {
    busy.value = false
  }
}

async function report(body: Record<string, unknown>) {
  await api('/spike/ln-outcome', { method: 'POST', body }).catch(() => undefined)
}

function startVerifyPolling(paymentHash: string) {
  if (!invoice.value?.hasVerify) {
    log.add(
      'No status URL from this service. M-Pesa delivery usually takes under 40 s: check the phone.',
    )
    return
  }
  const deadline = Date.now() + VERIFY_MAX_MS
  const tick = async () => {
    try {
      const res = await api<{ settled: boolean }>(`/spike/ln-verify/${paymentHash}`)
      settled.value = res.settled
      if (res.settled) {
        log.add('Lightning payment confirmed ✓', 'success')
        return
      }
    } catch {
      // a failed status read is not an outcome; keep checking
    }
    if (Date.now() < deadline) verifyTimer = setTimeout(tick, VERIFY_POLL_MS)
    else
      log.add('Still not confirmed after 5 minutes. Do not pay again; check the recipient.', 'warn')
  }
  verifyTimer = setTimeout(tick, VERIFY_POLL_MS)
}

async function pay() {
  const nimiq = session.nimiq
  const inv = invoice.value
  if (!nimiq || !inv || payLocked.value) return
  busy.value = true
  log.add('Opening Nimiq Pay…')
  try {
    const result = await nimiq.payLightningInvoice({ invoice: inv.invoice })
    payLocked.value = true
    log.add(`Submitted ✓ (swap ${result.swapId})`, 'success')
    void report({
      paymentHash: inv.paymentHash,
      outcome: 'submitted',
      hash: result.hash,
      swapId: result.swapId,
    })
    startVerifyPolling(inv.paymentHash)
  } catch (err) {
    const e = classifyNimiqError(err)
    const ids = lightningIdsFrom(e.data)
    void report({ paymentHash: inv.paymentHash, outcome: 'error', errorType: e.type, ...ids })
    switch (e.kind) {
      case 'rejected':
        log.add('Payment cancelled. Nothing was sent.', 'info')
        break
      case 'invalid':
        log.add('That payment request expired or is invalid. Get a fresh one.', 'warn')
        invoice.value = null
        break
      case 'duplicate':
        payLocked.value = true
        log.add(
          'This payment was already submitted. Checking its status… (never paying again)',
          'warn',
        )
        startVerifyPolling(inv.paymentHash)
        break
      case 'outcome_unknown':
      case 'network':
        payLocked.value = true
        log.add(
          "We can't confirm yet whether this went through. Don't pay again. Checking…",
          'warn',
        )
        startVerifyPolling(inv.paymentHash)
        break
      case 'unsupported':
        log.add('This Nimiq Pay version cannot pay Lightning invoices. Update Nimiq Pay.', 'warn')
        break
      default:
        log.add(
          `Nimiq Pay could not complete this (${e.type}). Nothing was confirmed as sent.`,
          'error',
        )
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <RouterLink to="/" class="link mb-4 inline-block">← Home</RouterLink>
    <h1 class="text-xl font-bold mb-1">S3 · Lightning</h1>
    <p class="muted mb-4">Pay a Lightning address with NIM or USDT through Nimiq Pay.</p>

    <StatusMessage
      v-if="session.host.network === 'testnet'"
      tone="warn"
      text="Nimiq Pay is on testnet. Mainnet Lightning invoices will be rejected: switch Nimiq Pay to mainnet."
    />
    <StatusMessage
      v-if="session.status !== 'ready'"
      tone="warn"
      text="Open this inside Nimiq Pay."
    />

    <section class="card">
      <label class="label" for="ln-address">Lightning address</label>
      <input
        id="ln-address"
        v-model="address"
        class="input"
        autocomplete="off"
        autocapitalize="off"
        placeholder="name@domain.com"
      />

      <label class="label mt-3" for="ke-phone">…or build one from a Kenyan M-Pesa number</label>
      <input
        id="ke-phone"
        v-model="phone"
        class="input"
        inputmode="tel"
        autocomplete="off"
        placeholder="0712 345 678"
      />
      <div class="flex gap-2 mt-2">
        <button type="button" class="btn-ghost flex-1" @click="fillFromPhone('local')">
          07… form
        </button>
        <button type="button" class="btn-ghost flex-1" @click="fillFromPhone('international')">
          2547… form
        </button>
      </div>

      <label class="label mt-3" for="sats">Amount (sats)</label>
      <input
        id="sats"
        v-model.number="sats"
        class="input"
        type="number"
        inputmode="numeric"
        min="1"
      />

      <button
        type="button"
        class="btn-secondary mt-3"
        :disabled="busy || !address"
        @click="getInvoice"
      >
        1 · Get invoice
      </button>
    </section>

    <section v-if="invoice" class="card">
      <dl>
        <div class="row">
          <dt class="row-label">Amount</dt>
          <dd class="row-value">{{ Number(invoice.amountMsat) / 1000 }} sats</dd>
        </div>
        <div class="row">
          <dt class="row-label">Expires in</dt>
          <dd class="row-value">{{ secondsLeft > 0 ? `${secondsLeft} s` : 'expired' }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">Status</dt>
          <dd class="row-value">
            {{ settled === true ? 'Paid ✓' : payLocked ? 'Submitted, checking…' : 'Not paid' }}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        class="btn-primary mt-3"
        :disabled="busy || payLocked || secondsLeft <= 0 || session.status !== 'ready'"
        @click="pay"
      >
        {{ payLocked ? 'Submitted: do not pay again' : '2 · Pay with Nimiq Pay' }}
      </button>
    </section>

    <StepLog :entries="log.entries.value" />
  </main>
</template>
