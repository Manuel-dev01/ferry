<script setup lang="ts">
import './spike.css'
import { CORRIDORS, type CorridorCurrency, type Institution } from '@ferry/shared'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Address, Hex } from 'viem'
import StatusMessage from '../../components/StatusMessage.vue'
import StepLog from '../../components/StepLog.vue'
import { useStepLog } from '../../composables/useStepLog'
import { pollTx } from '../../composables/useTxPoll'
import { api, ApiRequestError } from '../../lib/api'
import { fiatDisplay, polDisplay, polygonscanTx, usdtDisplay } from '../../lib/format'
import {
  classifyEvmError,
  currentChainId,
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
  approve: { to: Address; data: Hex }
  createOrder: { to: Address; data: Hex }
}
interface OrderState {
  stage: 'pending' | 'reverted' | 'no_order' | 'created' | 'settled' | 'refunded'
  orderId?: string
  aggregator: { status: string | null; txHash: string | null } | null
}

// approve + createOrder use ~300k gas; at Polygon peaks (~300 gwei) that is ~0.09 POL.
const MIN_GAS_WEI = 10n ** 17n // 0.1 POL
const ORDER_POLL_MS = 5_000
const ORDER_POLL_MAX = 120 // 10 minutes

const session = useSessionStore()
const log = useStepLog()
const busy = ref(false)

const currency = ref<CorridorCurrency>('NGN')
const institutions = ref<Institution[]>([])
const query = ref('')
const institution = ref('')
const account = ref('')
const amount = ref('1')

const prepared = ref<Prepared | null>(null)
const onPolygon = ref<boolean | null>(null)
const approved = ref(false)
const orderTx = ref<Hex | null>(null)
const order = ref<OrderState | null>(null)
let stopPolling = false
onUnmounted(() => (stopPolling = true))

const describe = (err: unknown) =>
  err instanceof ApiRequestError
    ? `${err.message} (${err.code}${err.ref ? `, ${err.ref}` : ''})`
    : err instanceof Error
      ? err.message
      : String(err)

async function loadInstitutions() {
  institutions.value = []
  institution.value = ''
  try {
    institutions.value = await api<Institution[]>(`/v1/institutions/${currency.value}`)
  } catch (err) {
    log.add(`Could not load banks: ${describe(err)}`, 'error')
  }
}
onMounted(loadInstitutions)
watch(currency, loadInstitutions)
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return institutions.value.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 50)
})

async function connect() {
  const r = await session.connectEvm()
  log.add(r === 'ok' ? 'Wallet connected ✓' : `Connect: ${r}`, r === 'ok' ? 'success' : 'warn')
}

async function prepare() {
  if (!session.evmAddress) return
  busy.value = true
  prepared.value = null
  approved.value = false
  try {
    log.add('Checking the account name and building the order…')
    prepared.value = await api<Prepared>('/spike/gateway/prepare', {
      method: 'POST',
      body: {
        currency: currency.value,
        institution: institution.value,
        accountIdentifier: account.value,
        amount: amount.value,
        from: session.evmAddress,
      },
    })
    approved.value = !prepared.value.needsApprove
    log.add(
      `Name: ${prepared.value.accountName} at ${prepared.value.institutionName}. ` +
        `They receive ≈ ${fiatDisplay(prepared.value.theyReceiveMinor, currency.value)}.`,
      'success',
    )
    await session.loadBalances().catch(() => undefined)
    onPolygon.value = (await currentChainId()) === '0x89'
  } catch (err) {
    log.add(`Prepare failed: ${describe(err)}`, 'error')
  } finally {
    busy.value = false
  }
}

const needsGas = computed(() => !!session.balances && session.balances.pol < MIN_GAS_WEI)

async function getGas() {
  if (!session.evmAddress) return
  busy.value = true
  try {
    log.add('Asking Ferry for a little POL for gas…')
    await api('/spike/gas-drip', { method: 'POST', body: { address: session.evmAddress } })
    await session.loadBalances()
    log.add(`Gas ready: ${polDisplay(session.balances?.pol ?? 0n)} POL`, 'success')
  } catch (err) {
    log.add(`Gas drip failed: ${describe(err)}`, 'error')
  } finally {
    busy.value = false
  }
}

async function switchChain() {
  busy.value = true
  try {
    await switchToPolygon()
    onPolygon.value = (await currentChainId()) === '0x89'
    log.add(
      onPolygon.value ? 'On Polygon ✓' : 'Still not on Polygon',
      onPolygon.value ? 'success' : 'warn',
    )
  } catch (err) {
    log.add(
      classifyEvmError(err) === 'rejected'
        ? 'Switch cancelled.'
        : `Switch failed: ${describe(err)}`,
      'warn',
    )
  } finally {
    busy.value = false
  }
}

async function send(label: string, call: { to: Address; data: Hex }): Promise<Hex | null> {
  try {
    log.add(`Asking Nimiq Pay to ${label}…`)
    return await sendTransaction({ from: session.evmAddress!, to: call.to, data: call.data })
  } catch (err) {
    log.add(
      classifyEvmError(err) === 'rejected'
        ? 'Cancelled. Nothing was sent.'
        : `Failed: ${describe(err)}`,
      'warn',
    )
    return null
  }
}

async function approve() {
  if (!prepared.value) return
  busy.value = true
  try {
    const hash = await send('approve the USDT', prepared.value.approve)
    if (!hash) return
    log.add('Approval sent. Waiting for it to be mined…')
    const status = await pollTx(hash)
    approved.value = status === 'success'
    log.add(`Approval ${status}`, approved.value ? 'success' : 'error')
  } finally {
    busy.value = false
  }
}

async function createOrder() {
  if (!prepared.value) return
  busy.value = true
  try {
    const hash = await send('create the order', prepared.value.createOrder)
    if (!hash) return
    orderTx.value = hash
    log.add('Order sent. Following it…', 'success')
    void follow(hash)
  } finally {
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
        log.add(
          `Stage: ${order.value.stage} · Paycrest: ${order.value.aggregator?.status ?? 'not indexed yet'}`,
          order.value.stage === 'settled'
            ? 'success'
            : order.value.stage === 'refunded' || order.value.stage === 'reverted'
              ? 'warn'
              : 'info',
        )
      }
      if (['settled', 'refunded', 'reverted', 'no_order'].includes(order.value.stage)) return
    } catch {
      // a failed read is not an outcome
    }
    await new Promise((r) => setTimeout(r, ORDER_POLL_MS))
  }
}
</script>

<template>
  <main class="page">
    <RouterLink to="/settings" class="link mb-4 inline-block">← Settings</RouterLink>
    <h1 class="fy-display" style="font-size: 26px; margin-bottom: 6px">S5 · Real $1 via Gateway</h1>
    <p class="muted mb-4">
      Your wallet approves the USDT and creates the order on Paycrest's Gateway contract. Refunds
      come back to your wallet. No Paycrest API key is involved.
    </p>
    <StatusMessage
      tone="warn"
      text="Real money. Paycrest advises against key-less orders: use only your own account and a small amount."
    />

    <section class="card">
      <button v-if="!session.evmAddress" type="button" class="btn-primary" @click="connect">
        Connect wallet
      </button>
      <template v-else>
        <p class="muted" style="margin: 0 0 12px">
          Wallet {{ session.evmAddress.slice(0, 6) }}…{{ session.evmAddress.slice(-4) }}
          <template v-if="session.balances">
            · {{ usdtDisplay(session.balances.usdt) }} USDT ·
            {{ polDisplay(session.balances.pol) }} POL
          </template>
        </p>
        <label class="label" for="s5-country">Country</label>
        <select id="s5-country" v-model="currency" class="input mb-3">
          <option v-for="c in CORRIDORS" :key="c.currency" :value="c.currency">{{ c.name }}</option>
        </select>
        <label class="label" for="s5-search">Bank or wallet</label>
        <input
          id="s5-search"
          v-model="query"
          class="input mb-2"
          placeholder="Search"
          autocomplete="off"
        />
        <select v-model="institution" class="input mb-3" aria-label="Bank or wallet">
          <option value="" disabled>Choose…</option>
          <option v-for="i in filtered" :key="i.code" :value="i.code">{{ i.name }}</option>
        </select>
        <label class="label" for="s5-account">Account number (yours)</label>
        <input
          id="s5-account"
          v-model="account"
          class="input mb-3"
          inputmode="numeric"
          autocomplete="off"
        />
        <label class="label" for="s5-amount">Amount (USDT)</label>
        <input
          id="s5-amount"
          v-model="amount"
          class="input mb-3"
          inputmode="decimal"
          autocomplete="off"
        />
        <button
          type="button"
          class="btn-secondary"
          :disabled="busy || !institution || !account"
          @click="prepare"
        >
          Check name and prepare
        </button>
      </template>
    </section>

    <section v-if="prepared" class="card">
      <dl>
        <div class="row">
          <dt class="row-label">Name</dt>
          <dd class="row-value">{{ prepared.accountName }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">They receive</dt>
          <dd class="row-value">≈ {{ fiatDisplay(prepared.theyReceiveMinor, currency) }}</dd>
        </div>
        <div class="row">
          <dt class="row-label">You send</dt>
          <dd class="row-value">{{ usdtDisplay(BigInt(prepared.amountUnits)) }} USDT</dd>
        </div>
        <div class="row">
          <dt class="row-label">Rate</dt>
          <dd class="row-value">{{ prepared.rate }}</dd>
        </div>
      </dl>
      <div class="flex flex-col gap-2 mt-3">
        <button
          v-if="needsGas"
          type="button"
          class="btn-secondary"
          :disabled="busy"
          @click="getGas"
        >
          0 · Get gas (POL)
        </button>
        <button
          v-else-if="onPolygon === false"
          type="button"
          class="btn-secondary"
          :disabled="busy"
          @click="switchChain"
        >
          1 · Switch to Polygon
        </button>
        <button
          v-else-if="!approved"
          type="button"
          class="btn-primary"
          :disabled="busy"
          @click="approve"
        >
          2 · Approve USDT
        </button>
        <button
          v-else-if="!orderTx"
          type="button"
          class="btn-primary"
          :disabled="busy"
          @click="createOrder"
        >
          3 · Create the order
        </button>
        <a v-if="orderTx" class="link" :href="polygonscanTx(orderTx)" target="_blank" rel="noopener"
          >Order transaction ↗</a
        >
        <a
          v-if="order?.aggregator?.txHash"
          class="link"
          :href="polygonscanTx(order.aggregator.txHash)"
          target="_blank"
          rel="noopener"
          >Settlement transaction ↗</a
        >
      </div>
    </section>

    <StepLog :entries="log.entries.value" />
  </main>
</template>
