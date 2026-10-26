<script setup lang="ts">
import './spike.css'
import {
  buildMetaTxTypedData,
  formatUsdt,
  MoneyFormatError,
  parseUsdt,
  shortAddress,
  USDT0_ADDRESS,
  type SpikeConfigResponse,
  type SpikeGasDripResponse,
  type SpikeTxResponse,
} from '@ferry/shared'
import { computed, onMounted, ref } from 'vue'
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import StatusMessage from '../../components/StatusMessage.vue'
import StepLog from '../../components/StepLog.vue'
import { useStepLog } from '../../composables/useStepLog'
import { pollTx } from '../../composables/useTxPoll'
import { api, ApiRequestError } from '../../lib/api'
import { polDisplay, polygonscanTx } from '../../lib/format'
import {
  classifyEvmError,
  currentChainId,
  requestAccount,
  sendTransaction,
  signTypedDataV4,
  switchToPolygon,
} from '../../providers/evm'
import { useSessionStore } from '../../stores/session'

const session = useSessionStore()
const config = ref<SpikeConfigResponse | null>(null)
const configError = ref<string | null>(null)
const amountInput = ref('1')

const amount = computed<bigint | null>(() => {
  try {
    const v = parseUsdt(amountInput.value)
    return v > 0n && config.value && v <= BigInt(config.value.maxUsdt) ? v : null
  } catch (err) {
    if (err instanceof MoneyFormatError) return null
    throw err
  }
})

const describe = (err: unknown) =>
  err instanceof ApiRequestError
    ? `${err.message} (${err.code}${err.ref ? `, ${err.ref}` : ''})`
    : err instanceof Error
      ? err.message
      : String(err)

onMounted(async () => {
  try {
    config.value = await api<SpikeConfigResponse>('/spike/config')
  } catch (err) {
    configError.value = describe(err)
  }
})

async function connect() {
  try {
    session.evmAddress = await requestAccount()
  } catch (err) {
    configError.value =
      classifyEvmError(err) === 'rejected' ? 'Connect was cancelled.' : describe(err)
  }
}

// ---------------- Path A: meta-transaction ----------------
const logA = useStepLog()
const busyA = ref(false)
const approvalsA = ref(0)
const txA = ref<SpikeTxResponse | null>(null)

async function runPathA() {
  const from = session.evmAddress
  if (!from || !config.value?.recipient || amount.value === null) return
  busyA.value = true
  txA.value = null
  try {
    const { nonce } = await api<{ nonce: string }>(`/spike/metatx/nonce/${from}`)
    const functionSignature = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [config.value.recipient!, amount.value],
    })
    const typedData = buildMetaTxTypedData({ nonce, from, functionSignature })
    logA.add(`Nonce ${nonce}. Asking Nimiq Pay to sign (eth_signTypedData_v4)…`)
    let signature: Hex
    try {
      approvalsA.value += 1
      signature = await signTypedDataV4(from, typedData)
    } catch (err) {
      const kind = classifyEvmError(err)
      logA.add(
        kind === 'rejected'
          ? 'Signature rejected. Nothing was sent.'
          : `Sign failed: ${describe(err)}`,
        'warn',
      )
      return
    }
    logA.add('Signed ✓. Relaying…', 'success')
    const res = await api<SpikeTxResponse>('/spike/relay', {
      method: 'POST',
      body: { from, nonce, functionSignature, signature },
    })
    txA.value = res
    if (res.status === 'success') logA.add('Mined ✓ USDT moved, Ferry paid the gas.', 'success')
    else if (res.status === 'reverted') logA.add('Transaction reverted on-chain.', 'error')
    else {
      logA.add(`Broadcast, outcome ${res.status}. Checking the network… don't sign again.`, 'warn')
      const final = await pollTx(res.txHash)
      txA.value = { ...res, status: final }
      logA.add(`Final status: ${final}`, final === 'success' ? 'success' : 'warn')
    }
  } catch (err) {
    logA.add(`Relay error: ${describe(err)}`, 'error')
  } finally {
    busyA.value = false
  }
}

// ---------------- Path B: gas drip + native transfer ----------------
const logB = useStepLog()
const busyB = ref(false)
const approvalsB = ref(0)
const onPolygon = ref<boolean | null>(null)
const txB = ref<SpikeTxResponse | null>(null)

async function dripGas() {
  const address = session.evmAddress
  if (!address) return
  busyB.value = true
  try {
    logB.add('Requesting gas from Ferry…')
    const res = await api<SpikeGasDripResponse>('/spike/gas-drip', {
      method: 'POST',
      body: { address },
    })
    logB.add(
      res.status === 'already_funded'
        ? 'You already have enough POL for gas.'
        : `Gas sent (${res.txStatus}) ${res.txHash ?? ''}`,
      'success',
    )
    onPolygon.value = (await currentChainId()) === '0x89'
    logB.add(onPolygon.value ? 'Wallet is on Polygon.' : 'Wallet is not on Polygon yet.')
  } catch (err) {
    logB.add(`Gas drip failed: ${describe(err)}`, 'error')
  } finally {
    busyB.value = false
  }
}

async function skipDrip() {
  onPolygon.value = (await currentChainId()) === '0x89'
  logB.add(
    `Skipped gas drip. ${onPolygon.value ? 'Wallet is on Polygon.' : 'Wallet is not on Polygon yet.'}`,
  )
}

async function switchChain() {
  busyB.value = true
  try {
    approvalsB.value += 1
    await switchToPolygon()
    onPolygon.value = (await currentChainId()) === '0x89'
    logB.add(
      onPolygon.value ? 'Switched to Polygon ✓. Now tap Send.' : 'Still not on Polygon.',
      'success',
    )
  } catch (err) {
    logB.add(
      classifyEvmError(err) === 'rejected'
        ? 'Switch cancelled.'
        : `Switch failed: ${describe(err)}`,
      'warn',
    )
  } finally {
    busyB.value = false
  }
}

async function sendNative() {
  const from = session.evmAddress
  if (!from || !config.value?.recipient || amount.value === null) return
  busyB.value = true
  txB.value = null
  try {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [config.value.recipient!, amount.value],
    })
    logB.add('Asking Nimiq Pay to send (eth_sendTransaction)…')
    let hash: Hex
    try {
      approvalsB.value += 1
      hash = await sendTransaction({ from, to: USDT0_ADDRESS, data })
    } catch (err) {
      const kind = classifyEvmError(err)
      logB.add(
        kind === 'rejected' ? 'Send rejected. Nothing was sent.' : `Send failed: ${describe(err)}`,
        'warn',
      )
      return
    }
    txB.value = { txHash: hash, status: 'pending' }
    logB.add('Submitted ✓. Waiting for it to be mined…', 'success')
    const final = await pollTx(hash)
    txB.value = { txHash: hash, status: final }
    logB.add(`Final status: ${final}`, final === 'success' ? 'success' : 'warn')
  } finally {
    busyB.value = false
  }
}
</script>

<template>
  <main class="page">
    <RouterLink to="/" class="link mb-4 inline-block">← Home</RouterLink>
    <h1 class="text-xl font-bold mb-1">S2 · Gasless USDT</h1>
    <p class="muted mb-4">
      Two ways to send up to {{ config ? formatUsdt(BigInt(config.maxUsdt)) : '…' }} USDT. Compare
      the confirmation screens.
    </p>

    <StatusMessage v-if="configError" tone="error" :text="configError" />

    <section v-if="config" class="card">
      <dl>
        <div class="row">
          <dt class="row-label">Recipient</dt>
          <dd class="row-value font-mono">
            {{ config.recipient ? shortAddress(config.recipient) : 'not configured on the server' }}
          </dd>
        </div>
        <div class="row">
          <dt class="row-label">Relayer gas</dt>
          <dd class="row-value">
            {{
              config.relayer ? `${polDisplay(BigInt(config.relayer.pol))} POL` : 'not configured'
            }}
          </dd>
        </div>
      </dl>
      <label class="label mt-3" for="amount">Amount (USDT)</label>
      <input
        id="amount"
        v-model="amountInput"
        class="input"
        inputmode="decimal"
        autocomplete="off"
      />
      <StatusMessage
        v-if="amount === null"
        class="mt-2"
        tone="warn"
        :text="`Enter an amount above 0 and up to ${formatUsdt(BigInt(config.maxUsdt))}.`"
      />
      <button v-if="!session.evmAddress" type="button" class="btn-primary mt-3" @click="connect">
        Connect wallet
      </button>
      <p v-else class="muted mt-3">
        From <span class="font-mono">{{ shortAddress(session.evmAddress) }}</span>
      </p>
    </section>

    <section v-if="config && session.evmAddress" class="card">
      <h2 class="card-title">Path A · Meta-transaction</h2>
      <p class="muted mb-3">
        You sign; Ferry's relayer submits and pays the gas. Approvals so far: {{ approvalsA }}
      </p>
      <button
        type="button"
        class="btn-primary"
        :disabled="busyA || amount === null || !config.relayer"
        @click="runPathA"
      >
        {{ busyA ? 'Working…' : `Sign and send ${amountInput} USDT` }}
      </button>
      <StepLog :entries="logA.entries.value" />
      <a
        v-if="txA"
        class="link mt-2 inline-block"
        :href="polygonscanTx(txA.txHash)"
        target="_blank"
        rel="noopener"
        >View on Polygonscan</a
      >
    </section>

    <section v-if="config && session.evmAddress" class="card">
      <h2 class="card-title">Path B · Gas drip + normal transfer</h2>
      <p class="muted mb-3">
        Ferry sends you a little POL; you send USDT yourself. Approvals so far: {{ approvalsB }}
      </p>
      <button
        v-if="onPolygon === null"
        type="button"
        class="btn-secondary"
        :disabled="busyB || !config.gasDrip.enabled"
        @click="dripGas"
      >
        {{
          config.gasDrip.enabled
            ? `1 · Get gas (${polDisplay(BigInt(config.gasDrip.amountWei))} POL)`
            : 'Gas drip is off on the server'
        }}
      </button>
      <button
        v-if="onPolygon === null"
        type="button"
        class="btn-ghost mt-2"
        :disabled="busyB"
        @click="skipDrip"
      >
        I already have POL: skip
      </button>
      <button
        v-else-if="!onPolygon"
        type="button"
        class="btn-secondary"
        :disabled="busyB"
        @click="switchChain"
      >
        2 · Switch to Polygon
      </button>
      <button
        v-else
        type="button"
        class="btn-primary"
        :disabled="busyB || amount === null"
        @click="sendNative"
      >
        {{ busyB ? 'Working…' : `3 · Send ${amountInput} USDT` }}
      </button>
      <StepLog :entries="logB.entries.value" />
      <a
        v-if="txB"
        class="link mt-2 inline-block"
        :href="polygonscanTx(txB.txHash)"
        target="_blank"
        rel="noopener"
        >View on Polygonscan</a
      >
    </section>
  </main>
</template>
