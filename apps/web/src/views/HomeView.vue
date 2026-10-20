<script setup lang="ts">
import { shortAddress } from '@ferry/shared'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import InfoRow from '../components/InfoRow.vue'
import SkeletonBlock from '../components/SkeletonBlock.vue'
import StatusMessage from '../components/StatusMessage.vue'
import { ApiRequestError } from '../lib/api'
import { nimDisplay, polDisplay, usdtDisplay } from '../lib/format'
import { classifyEvmError, hasEvmProvider, requestAccount } from '../providers/evm'
import { openInNimiqPayUrl } from '../providers/host'
import { classifyNimiqError } from '../providers/nimiq'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const session = useSessionStore()
const spikesEnabled = import.meta.env.VITE_SPIKES === 'true'

type Msg = { tone: 'info' | 'warn' | 'error'; text: string; ref?: string } | null

const evmBusy = ref(false)
const evmMsg = ref<Msg>(null)
const balanceFailed = ref(false)

const nimBusy = ref(false)
const nimMsg = ref<Msg>(null)

async function loadBalances() {
  balanceFailed.value = false
  try {
    await session.loadBalances()
  } catch (err) {
    balanceFailed.value = true
    evmMsg.value = {
      tone: 'error',
      text:
        err instanceof ApiRequestError && err.code === 'OFFLINE'
          ? t('errors.offline')
          : t('evm.balanceFailed'),
      ref: err instanceof ApiRequestError ? err.ref : undefined,
    }
  }
}

// Approval 1 of a cash-out: only ever runs from this button.
async function connect() {
  evmMsg.value = null
  if (!hasEvmProvider()) {
    evmMsg.value = { tone: 'warn', text: t('evm.unavailable') }
    return
  }
  evmBusy.value = true
  try {
    session.evmAddress = await requestAccount()
    await loadBalances()
  } catch (err) {
    const kind = classifyEvmError(err)
    evmMsg.value =
      kind === 'rejected'
        ? { tone: 'info', text: t('evm.rejected') }
        : kind === 'unavailable'
          ? { tone: 'warn', text: t('evm.unavailable') }
          : { tone: 'error', text: t('errors.generic') }
  } finally {
    evmBusy.value = false
  }
}

async function showNim() {
  nimMsg.value = null
  const nimiq = session.nimiq
  if (!nimiq) return
  nimBusy.value = true
  try {
    const accounts = await nimiq.listAccounts()
    session.nimAddress = accounts[0] ?? null
    if (!session.canReadNimBalance()) {
      nimMsg.value = { tone: 'info', text: t('nim.noBalanceApi') }
      return
    }
    try {
      await session.loadNimBalance()
    } catch {
      nimMsg.value = { tone: 'warn', text: t('nim.balanceFailed') }
    }
  } catch (err) {
    const { kind } = classifyNimiqError(err)
    nimMsg.value =
      kind === 'rejected'
        ? { tone: 'info', text: t('nim.rejected') }
        : { tone: 'error', text: t('errors.generic') }
  } finally {
    nimBusy.value = false
  }
}
</script>

<template>
  <main class="page">
    <header class="mb-6">
      <h1 class="text-2xl font-bold">{{ t('app.name') }}</h1>
      <p class="muted">{{ t('app.tagline') }}</p>
    </header>

    <template v-if="session.status === 'loading'">
      <p class="sr-only">{{ t('outside.waiting') }}</p>
      <SkeletonBlock :lines="3" />
      <SkeletonBlock :lines="2" />
    </template>

    <section v-else-if="session.status === 'outside'" class="card text-center">
      <h2 class="card-title">{{ t('outside.title') }}</h2>
      <p class="muted mb-4">{{ t('outside.body') }}</p>
      <a class="btn-primary" :href="openInNimiqPayUrl()">{{ t('outside.open') }}</a>
    </section>

    <template v-else>
      <StatusMessage
        v-if="session.host.network === 'testnet'"
        tone="warn"
        :text="t('host.testnetBanner')"
      />

      <section class="card" aria-labelledby="host-title">
        <h2 id="host-title" class="card-title">{{ t('host.title') }}</h2>
        <dl>
          <InfoRow :label="t('host.language')" :value="session.host.language" />
          <InfoRow :label="t('host.fiat')" :value="session.host.fiat ?? t('host.unknown')" />
          <InfoRow :label="t('host.network')" :value="session.host.network" />
        </dl>
      </section>

      <section class="card" aria-labelledby="evm-title">
        <h2 id="evm-title" class="card-title">{{ t('evm.title') }}</h2>
        <template v-if="session.evmAddress">
          <dl>
            <InfoRow :label="t('evm.address')" :value="shortAddress(session.evmAddress)" mono />
            <template v-if="session.balances">
              <InfoRow :label="t('evm.usdt')" :value="usdtDisplay(session.balances.usdt)" />
              <InfoRow :label="t('evm.pol')" :value="polDisplay(session.balances.pol)" />
            </template>
          </dl>
          <button
            v-if="balanceFailed"
            type="button"
            class="btn-secondary mt-3"
            @click="loadBalances"
          >
            {{ t('evm.retry') }}
          </button>
        </template>
        <template v-else>
          <p class="muted mb-3">{{ t('evm.connectHint') }}</p>
          <button type="button" class="btn-primary" :disabled="evmBusy" @click="connect">
            {{ evmBusy ? t('evm.connecting') : t('evm.connect') }}
          </button>
        </template>
        <StatusMessage
          v-if="evmMsg"
          class="mt-3"
          :tone="evmMsg.tone"
          :text="evmMsg.text"
          :support-ref="evmMsg.ref"
        />
      </section>

      <section class="card" aria-labelledby="nim-title">
        <h2 id="nim-title" class="card-title">{{ t('nim.title') }}</h2>
        <dl v-if="session.nimAddress">
          <InfoRow :label="t('evm.address')" :value="session.nimAddress" mono />
          <InfoRow
            v-if="session.nimBalance !== null"
            :label="t('nim.balance')"
            :value="`${nimDisplay(session.nimBalance)} NIM`"
          />
        </dl>
        <template v-else>
          <p class="muted mb-3">{{ t('nim.hint') }}</p>
          <button type="button" class="btn-secondary" :disabled="nimBusy" @click="showNim">
            {{ nimBusy ? t('evm.connecting') : t('nim.show') }}
          </button>
        </template>
        <StatusMessage v-if="nimMsg" class="mt-3" :tone="nimMsg.tone" :text="nimMsg.text" />
      </section>

      <nav v-if="spikesEnabled" class="card" aria-label="Spikes">
        <h2 class="card-title">Phase 0 spikes</h2>
        <RouterLink class="btn-secondary mb-2" to="/spike/s2">S2 · Gasless $1</RouterLink>
        <RouterLink class="btn-secondary mb-2" to="/spike/s3">S3 · Lightning</RouterLink>
        <RouterLink class="btn-secondary" to="/spike/s4">S4 · Nimiq sign-in</RouterLink>
      </nav>
    </template>
  </main>
</template>
