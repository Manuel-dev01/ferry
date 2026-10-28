<script setup lang="ts">
import { CORRIDORS, type CorridorCurrency, type Institution } from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Address, Hex } from 'viem'
import AppHeader from '../../components/AppHeader.vue'
import Banner from '../../components/Banner.vue'
import Icon from '../../components/Icon.vue'
import Monogram from '../../components/Monogram.vue'
import StepLog from '../../components/StepLog.vue'
import { useStepLog } from '../../composables/useStepLog'
import { pollTx } from '../../composables/useTxPoll'
import { api, ApiRequestError } from '../../lib/api'
import { FLAGS } from '../../lib/corridors'
import { fiatDisplay, polDisplay, polygonscanTx, usdtDisplay } from '../../lib/format'
import { tinyAddress } from '../../lib/names'
import {
  classifyEvmError,
  currentChainId,
  evmErrorText,
  sendTransaction,
  switchToPolygon,
} from '../../providers/evm'
import { useSessionStore } from '../../stores/session'

interface Prepared {
  accountName: string
  institutionName: string
  rate: string
  amountUnits: string
  theyReceiveMinor: string
  gateway: Address
  needsApprove: boolean
  gasNeededWei: string
  approve: { to: Address; data: Hex }
  createOrder: { to: Address; data: Hex }
}
interface OrderState {
  stage: 'pending' | 'reverted' | 'no_order' | 'created' | 'settled' | 'refunded'
  orderId?: string
  aggregator: { status: string | null; txHash: string | null } | null
}
type StepKey = 'gas' | 'network' | 'approve' | 'order' | 'payout'
type StepState = 'done' | 'now' | 'next' | 'failed'

const ORDER_POLL_MS = 5_000
const ORDER_POLL_MAX = 120 // 10 minutes

const session = useSessionStore()
const log = useStepLog()
const busy = ref(false)

const currency = ref<CorridorCurrency>('NGN')
const institutions = ref<Institution[]>([])
const query = ref('')
const institution = ref<Institution | null>(null)
const banksFailed = ref(false)
const account = ref('')
const amount = ref('1')

const prepared = ref<Prepared | null>(null)
const onPolygon = ref<boolean | null>(null)
const approved = ref(false)
const orderTx = ref<Hex | null>(null)
const order = ref<OrderState | null>(null)
/** What the current step is doing right now, in one line. Replaced, never appended. */
const status = ref('')
/** The latest problem, if any. Cleared when the user tries again. */
const problem = ref('')
let stopPolling = false
onUnmounted(() => (stopPolling = true))

const describe = (err: unknown) =>
  err instanceof ApiRequestError ? `${err.message} (${err.code})` : evmErrorText(err)

async function loadInstitutions() {
  banksFailed.value = false
  institutions.value = []
  institution.value = null
  try {
    institutions.value = await api<Institution[]>(`/v1/institutions/${currency.value}`)
  } catch (err) {
    banksFailed.value = true
    log.add(`Could not load banks: ${describe(err)}`, 'error')
  }
}
onMounted(loadInstitutions)
watch(currency, loadInstitutions)
const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return institutions.value.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 6)
})
function choose(i: Institution) {
  institution.value = i
  query.value = ''
}

async function connect() {
  const r = await session.connectEvm()
  log.add(r === 'ok' ? 'Wallet connected' : `Connect: ${r}`, r === 'ok' ? 'success' : 'warn')
}

async function prepare() {
  if (!session.evmAddress || !institution.value) return
  busy.value = true
  problem.value = ''
  try {
    log.add('Checking the account name and building the order')
    prepared.value = await api<Prepared>('/spike/gateway/prepare', {
      method: 'POST',
      body: {
        currency: currency.value,
        institution: institution.value.code,
        accountIdentifier: account.value,
        amount: amount.value,
        from: session.evmAddress,
      },
    })
    approved.value = !prepared.value.needsApprove
    log.add(`Name: ${prepared.value.accountName}`, 'success')
    await session.loadBalances().catch(() => undefined)
    onPolygon.value = (await currentChainId()) === '0x89'
  } catch (err) {
    problem.value = describe(err)
    log.add(`Prepare failed: ${describe(err)}`, 'error')
  } finally {
    busy.value = false
  }
}

function edit() {
  prepared.value = null
  problem.value = ''
}

const needsGas = computed(
  () =>
    !!prepared.value &&
    !!session.balances &&
    !orderTx.value &&
    session.balances.pol < BigInt(prepared.value.gasNeededWei),
)

async function getGas() {
  if (!session.evmAddress) return
  busy.value = true
  problem.value = ''
  status.value = 'Ferry is sending a little POL to your wallet…'
  try {
    log.add('Asking Ferry for POL')
    await api('/spike/gas-drip', { method: 'POST', body: { address: session.evmAddress } })
    await session.loadBalances()
    log.add(`Gas ready: ${polDisplay(session.balances?.pol ?? 0n)} POL`, 'success')
    if (needsGas.value) problem.value = 'Gas is still short. Try again in a minute.'
  } catch (err) {
    problem.value = describe(err)
    log.add(`Gas drip failed: ${describe(err)}`, 'error')
  } finally {
    status.value = ''
    busy.value = false
  }
}

async function switchChain() {
  busy.value = true
  problem.value = ''
  status.value = 'Confirm the network switch in Nimiq Pay'
  try {
    await switchToPolygon()
    onPolygon.value = (await currentChainId()) === '0x89'
    if (!onPolygon.value) problem.value = 'Your wallet is still on another network.'
  } catch (err) {
    problem.value = classifyEvmError(err) === 'rejected' ? 'Switch cancelled.' : describe(err)
    log.add(`Switch: ${describe(err)}`, 'warn')
  } finally {
    status.value = ''
    busy.value = false
  }
}

async function send(label: string, call: { to: Address; data: Hex }): Promise<Hex | null> {
  try {
    status.value = 'Confirm in Nimiq Pay'
    log.add(`Asking Nimiq Pay to ${label}`)
    return await sendTransaction({ from: session.evmAddress!, to: call.to, data: call.data })
  } catch (err) {
    const rejected = classifyEvmError(err) === 'rejected'
    problem.value = rejected ? 'Cancelled. Nothing was sent.' : describe(err)
    log.add(`${label} failed: ${describe(err)}`, 'warn')
    // A failed send is often short gas; re-read the balance so the Get gas step can come back.
    await session.loadBalances().catch(() => undefined)
    return null
  }
}

async function approve() {
  if (!prepared.value) return
  busy.value = true
  problem.value = ''
  try {
    const hash = await send('approve the USDT', prepared.value.approve)
    if (!hash) return
    status.value = 'Waiting for the network…'
    const result = await pollTx(hash)
    approved.value = result === 'success'
    log.add(`Approval ${result} (${hash})`, approved.value ? 'success' : 'error')
    if (!approved.value) problem.value = `The approval ${result}. Nothing else was sent.`
    await session.loadBalances().catch(() => undefined)
  } finally {
    status.value = ''
    busy.value = false
  }
}

async function createOrder() {
  if (!prepared.value) return
  busy.value = true
  problem.value = ''
  try {
    const hash = await send('create the order', prepared.value.createOrder)
    if (!hash) return
    orderTx.value = hash
    log.add(`Order sent (${hash})`, 'success')
    void follow(hash)
  } finally {
    status.value = ''
    busy.value = false
  }
}

async function follow(hash: Hex) {
  let last = ''
  for (let i = 0; i < ORDER_POLL_MAX && !stopPolling; i++) {
    try {
      order.value = await api<OrderState>(`/spike/gateway/order/${hash}`)
      const now = `${order.value.stage}/${order.value.aggregator?.status ?? '-'}`
      if (now !== last) {
        last = now
        log.add(`Stage: ${now}`)
      }
      if (['settled', 'refunded', 'reverted', 'no_order'].includes(order.value.stage)) return
    } catch {
      // a failed read is not an outcome
    }
    await new Promise((r) => setTimeout(r, ORDER_POLL_MS))
  }
}

// ---- Steps ----

const STEP_TITLES: Record<StepKey, string> = {
  gas: 'Gas for your wallet',
  network: 'Polygon network',
  approve: 'Allow the USDT',
  order: 'Send the order',
  payout: 'Payout to your account',
}

const done = computed<Record<StepKey, boolean>>(() => ({
  gas: !needsGas.value,
  network: onPolygon.value === true,
  approve: approved.value,
  order: !!order.value && order.value.stage !== 'pending',
  payout: order.value?.stage === 'settled',
}))

const failedStep = computed<StepKey | null>(() => {
  const stage = order.value?.stage
  if (stage === 'reverted' || stage === 'no_order') return 'order'
  if (stage === 'refunded') return 'payout'
  return null
})

const current = computed<StepKey | null>(() => {
  for (const key of Object.keys(STEP_TITLES) as StepKey[]) if (!done.value[key]) return key
  return null
})

const steps = computed(() =>
  (Object.keys(STEP_TITLES) as StepKey[]).map((key) => {
    const state: StepState =
      failedStep.value === key
        ? 'failed'
        : done.value[key]
          ? 'done'
          : current.value === key
            ? 'now'
            : 'next'
    return { key, title: STEP_TITLES[key], state, detail: stepDetail(key) }
  }),
)

function stepDetail(key: StepKey): string {
  const b = session.balances
  switch (key) {
    case 'gas':
      return b ? `${polDisplay(b.pol)} POL` : ''
    case 'network':
      return ''
    case 'approve':
      return prepared.value ? `${usdtDisplay(BigInt(prepared.value.amountUnits))} USDT` : ''
    case 'order':
      return ''
    case 'payout':
      return prepared.value ? fiatDisplay(prepared.value.theyReceiveMinor, currency.value) : ''
  }
}

const nowText = computed(() => {
  if (status.value) return status.value
  switch (current.value) {
    case 'gas':
      return 'Ferry tops up your POL so Nimiq Pay can pay the network fee.'
    case 'network':
      return 'Your wallet needs to be on Polygon.'
    case 'approve':
      return 'Let Paycrest’s contract take exactly this amount.'
    case 'order':
      return orderTx.value
        ? 'Waiting for the network…'
        : 'Your USDT goes to the contract; your name and account go encrypted.'
    case 'payout':
      return order.value?.aggregator?.status
        ? `Paycrest: ${order.value.aggregator.status}`
        : 'Waiting for a payout provider to pick it up…'
    default:
      return ''
  }
})

const doneCount = computed(() => Object.values(done.value).filter(Boolean).length)

const action = computed<{ label: string; run: () => Promise<void> } | null>(() => {
  if (!prepared.value || orderTx.value) return null
  const usdt = usdtDisplay(BigInt(prepared.value.amountUnits))
  if (needsGas.value) return { label: 'Get gas', run: getGas }
  if (onPolygon.value === false) return { label: 'Switch to Polygon', run: switchChain }
  if (!approved.value) return { label: `Allow ${usdt} USDT`, run: approve }
  return { label: `Send ${usdt} USDT`, run: createOrder }
})

const outcome = computed(() => {
  switch (order.value?.stage) {
    case 'settled':
      return { tone: 'success' as const, text: 'Paid out. Check your bank app.' }
    case 'refunded':
      return { tone: 'warning' as const, text: 'Refunded. The USDT is back in your wallet.' }
    case 'reverted':
      return { tone: 'danger' as const, text: 'The order transaction failed. No USDT moved.' }
    case 'no_order':
      return { tone: 'danger' as const, text: 'No order was found in that transaction.' }
    default:
      return null
  }
})
</script>

<template>
  <main class="fy-screen">
    <AppHeader back="/settings">Test · Real payout</AppHeader>

    <div class="fy-content" style="gap: 18px">
      <h1 class="fy-display">Pay your own account</h1>
      <Banner
        tone="warning"
        icon="alert"
        body="Real money through Paycrest’s Gateway. Use your own account and a small amount."
      />

      <button
        v-if="!session.evmAddress"
        type="button"
        class="fy-btn fy-btn--primary"
        @click="connect"
      >
        Connect wallet
      </button>

      <template v-else>
        <dl class="fy-panel" style="margin: 0">
          <div class="fy-row">
            <dt class="fy-row__k">Wallet</dt>
            <dd class="fy-row__v">{{ tinyAddress(session.evmAddress) }}</dd>
          </div>
          <div v-if="session.balances" class="fy-row">
            <dt class="fy-row__k">Balance</dt>
            <dd class="fy-row__v">
              {{ usdtDisplay(session.balances.usdt) }} USDT ·
              {{ polDisplay(session.balances.pol) }} POL
            </dd>
          </div>
        </dl>

        <!-- 1. Who gets paid -->
        <form v-if="!prepared" class="flex flex-col gap-4" novalidate @submit.prevent="prepare">
          <div class="flex flex-col gap-1.5">
            <span class="fy-label">Country</span>
            <div class="fy-filters" style="flex-wrap: wrap" role="radiogroup" aria-label="Country">
              <button
                v-for="c in CORRIDORS"
                :key="c.currency"
                type="button"
                class="fy-filter"
                role="radio"
                :aria-checked="currency === c.currency"
                :aria-pressed="currency === c.currency"
                @click="currency = c.currency"
              >
                {{ FLAGS[c.currency] }} {{ c.name }}
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="fy-label" for="s5-bank">Bank or wallet</label>
            <div v-if="institution" class="s5-chosen">
              <Monogram :name="institution.name" :seed="institution.code" size="sm" />
              <span class="s5-chosen__name">{{ institution.name }}</span>
              <button
                type="button"
                class="fy-btn fy-btn--text fy-btn--sm"
                style="min-height: 36px; padding: 0 12px; font-size: 14px"
                @click="institution = null"
              >
                Change
              </button>
            </div>
            <template v-else>
              <div class="fy-search">
                <Icon name="search" style="color: var(--fy-ink-2)" />
                <input
                  id="s5-bank"
                  v-model="query"
                  type="search"
                  autocomplete="off"
                  :placeholder="institutions.length ? 'Search banks and wallets' : 'Loading…'"
                />
              </div>
              <div v-if="matches.length" class="fy-list">
                <button
                  v-for="i in matches"
                  :key="i.code"
                  type="button"
                  class="fy-list-row"
                  @click="choose(i)"
                >
                  <Monogram :name="i.name" :seed="i.code" size="sm" />
                  <span class="fy-list-row__main">
                    <span class="fy-list-row__name">{{ i.name }}</span>
                  </span>
                </button>
              </div>
              <Banner
                v-else-if="banksFailed"
                tone="danger"
                body="Couldn’t load the bank list."
                action="Try again"
                @action="loadInstitutions"
              />
              <span v-else-if="query.trim() && institutions.length" class="fy-caption"
                >No match for “{{ query }}”.</span
              >
            </template>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="fy-label" for="s5-account">Your account number</label>
            <div class="fy-field">
              <input
                id="s5-account"
                v-model="account"
                inputmode="numeric"
                autocomplete="off"
                spellcheck="false"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="fy-label" for="s5-amount">Amount</label>
            <div class="fy-field">
              <input id="s5-amount" v-model="amount" inputmode="decimal" autocomplete="off" />
              <span class="fy-field__prefix">USDT</span>
            </div>
            <span class="fy-caption">Between 0.5 and 2 USDT.</span>
          </div>

          <button
            type="submit"
            class="fy-btn fy-btn--primary"
            :class="{ 'fy-btn--busy': busy }"
            :disabled="busy || !institution || !account"
          >
            {{ busy ? 'Checking…' : 'Check name' }}
            <span v-if="busy" class="fy-btn__progress" />
          </button>
        </form>

        <!-- 2. Check it, then go through the steps -->
        <template v-else>
          <dl class="fy-panel" style="margin: 0">
            <div class="fy-row">
              <dt class="fy-row__k">To</dt>
              <dd class="fy-row__v s5-name">{{ prepared.accountName }}</dd>
            </div>
            <div class="fy-row">
              <dt class="fy-row__k">Bank</dt>
              <dd class="fy-row__v">{{ prepared.institutionName }}</dd>
            </div>
            <div class="fy-row">
              <dt class="fy-row__k">They receive</dt>
              <dd class="fy-row__v" style="font-weight: 700">
                ≈ {{ fiatDisplay(prepared.theyReceiveMinor, currency) }}
              </dd>
            </div>
            <div class="fy-row">
              <dt class="fy-row__k">You send</dt>
              <dd class="fy-row__v">{{ usdtDisplay(BigInt(prepared.amountUnits)) }} USDT</dd>
            </div>
          </dl>
          <button
            v-if="!orderTx"
            type="button"
            class="fy-btn fy-btn--text fy-btn--sm self-start"
            :disabled="busy"
            @click="edit"
          >
            Edit details
          </button>

          <ol class="fy-steps" aria-live="polite" style="margin: 0; padding: 0; list-style: none">
            <template v-for="(step, i) in steps" :key="step.key">
              <li v-if="step.state === 'now'" class="fy-now fy-now--brand" aria-current="step">
                <div class="fy-now__top">
                  <span class="fy-eyebrow">Step {{ i + 1 }} of {{ steps.length }}</span>
                  <span>{{ step.detail }}</span>
                </div>
                <span class="fy-now__title">{{ step.title }}</span>
                <span class="s5-now-text">{{ nowText }}</span>
                <span class="fy-now__track"
                  ><span
                    class="fy-now__bar"
                    :style="{ width: `${((doneCount + 0.5) / steps.length) * 100}%` }"
                /></span>
              </li>
              <li
                v-else
                class="fy-step"
                :class="
                  step.state === 'failed'
                    ? 'fy-step--next s5-step--failed'
                    : `fy-step--${step.state}`
                "
              >
                <span class="fy-step__dot"
                  ><Icon v-if="step.state === 'done'" name="check" :size="14" :stroke="3" /><Icon
                    v-else-if="step.state === 'failed'"
                    name="alert"
                    :size="14"
                    :stroke="2.4"
                /></span>
                <span class="fy-step__label">{{ step.title }}</span>
                <span class="fy-step__time">{{ step.detail }}</span>
              </li>
            </template>
          </ol>

          <Banner v-if="outcome" :tone="outcome.tone" :body="outcome.text" />
          <Banner v-if="problem" tone="danger" :body="problem" />

          <div v-if="orderTx" class="flex flex-col gap-1">
            <a
              class="fy-btn fy-btn--text fy-btn--sm self-start"
              :href="polygonscanTx(orderTx)"
              target="_blank"
              rel="noopener"
            >
              Order on Polygonscan <Icon name="external" :size="16" />
            </a>
            <a
              v-if="order?.aggregator?.txHash"
              class="fy-btn fy-btn--text fy-btn--sm self-start"
              :href="polygonscanTx(order.aggregator.txHash)"
              target="_blank"
              rel="noopener"
            >
              Settlement on Polygonscan <Icon name="external" :size="16" />
            </a>
          </div>
        </template>

        <Banner v-if="problem && !prepared" tone="danger" :body="problem" />
      </template>

      <StepLog :entries="log.entries.value" />
    </div>

    <div v-if="action" class="fy-bottom">
      <button
        type="button"
        class="fy-btn fy-btn--primary"
        :class="{ 'fy-btn--busy': busy }"
        :disabled="busy"
        @click="action.run"
      >
        {{ busy ? status || 'Working…' : action.label }}
        <span v-if="busy" class="fy-btn__progress" />
      </button>
    </div>
  </main>
</template>

<style scoped>
.s5-chosen {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 0 6px 0 10px;
  border-radius: var(--fy-radius-m);
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
}
.s5-chosen__name {
  flex: 1;
  min-width: 0;
  font: 600 15px var(--fy-font-body);
}
.s5-name {
  font-weight: 700;
  word-break: normal;
  overflow-wrap: break-word;
}
.s5-now-text {
  font-size: 14px;
  opacity: 0.9;
}
.s5-step--failed .fy-step__dot {
  background: var(--fy-warning-soft);
  color: var(--fy-warning);
  box-shadow: none;
}
</style>
