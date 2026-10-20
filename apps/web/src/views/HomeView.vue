<script setup lang="ts">
import { shortAddress } from '@ferry/shared'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SkeletonBlock from '../components/SkeletonBlock.vue'
import StatusMessage from '../components/StatusMessage.vue'
import { SPIKES_ENABLED } from '../config'
import { nimDisplay, polDisplay, usdtDisplay } from '../lib/format'
import { openInNimiqPayUrl } from '../providers/host'
import { classifyNimiqError } from '../providers/nimiq'
import { useCashoutStore } from '../stores/cashout'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const router = useRouter()
const session = useSessionStore()
const draft = useCashoutStore()

type Msg = { tone: 'info' | 'warn' | 'error'; text: string } | null
const evmBusy = ref(false)
const evmMsg = ref<Msg>(null)
const nimBusy = ref(false)
const nimMsg = ref<Msg>(null)

async function connect() {
  evmMsg.value = null
  evmBusy.value = true
  const result = await session.connectEvm()
  evmBusy.value = false
  if (result === 'rejected') evmMsg.value = { tone: 'info', text: t('evm.rejected') }
  else if (result === 'unavailable') evmMsg.value = { tone: 'warn', text: t('evm.unavailable') }
  else if (result !== 'ok') evmMsg.value = { tone: 'error', text: t('errors.generic') }
}

async function retryBalances() {
  await session.loadBalances().catch(() => undefined)
}

async function showNim() {
  nimMsg.value = null
  const nimiq = session.nimiq
  if (!nimiq) return
  nimBusy.value = true
  try {
    session.nimAddress = (await nimiq.listAccounts())[0] ?? null
    if (!session.canReadNimBalance()) nimMsg.value = { tone: 'info', text: t('nim.noBalanceApi') }
    else
      await session
        .loadNimBalance()
        .catch(() => (nimMsg.value = { tone: 'warn', text: t('nim.balanceFailed') }))
  } catch (err) {
    nimMsg.value =
      classifyNimiqError(err).kind === 'rejected'
        ? { tone: 'info', text: t('nim.rejected') }
        : { tone: 'error', text: t('errors.generic') }
  } finally {
    nimBusy.value = false
  }
}

function startCashout(kind: 'self' | 'other') {
  draft.start(kind, session.host.fiat)
  void router.push('/cashout')
}
</script>

<template>
  <main class="page">
    <header class="mb-5 pt-2">
      <p class="text-sm font-semibold text-blue">{{ t('app.name') }}</p>
      <h1 class="text-2xl font-bold leading-tight">{{ t('app.tagline') }}</h1>
    </header>

    <template v-if="session.status === 'loading'">
      <p class="sr-only">{{ t('outside.waiting') }}</p>
      <SkeletonBlock :lines="2" />
      <SkeletonBlock :lines="3" />
    </template>

    <section v-else-if="session.status === 'outside'" class="card text-center">
      <span
        class="i-nimiq:logos-nimiq-pay-vertical text-6xl mb-3 inline-block"
        aria-hidden="true"
      />
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

      <section class="card" aria-labelledby="balance-title">
        <h2 id="balance-title" class="text-sm font-semibold text-neutral-800 mb-2">
          {{ t('home.balanceTitle') }}
        </h2>
        <template v-if="session.evmAddress">
          <p class="text-3xl font-bold">
            {{ session.balances ? usdtDisplay(session.balances.usdt) : '…' }}
            <span class="text-lg text-neutral-700">USDT</span>
          </p>
          <p class="text-sm text-neutral-700 font-mono mt-1">
            {{ shortAddress(session.evmAddress) }}
            <template v-if="session.balances">
              · {{ polDisplay(session.balances.pol) }} {{ t('evm.pol') }}
            </template>
          </p>
          <template v-if="session.balancesError">
            <StatusMessage class="mt-3" tone="error" :text="t('evm.balanceFailed')" />
            <button type="button" class="btn-secondary" @click="retryBalances">
              {{ t('common.tryAgain') }}
            </button>
          </template>
        </template>
        <template v-else>
          <p class="muted mb-3">{{ t('home.connectHint') }}</p>
          <button type="button" class="btn-secondary" :disabled="evmBusy" @click="connect">
            {{ evmBusy ? t('evm.connecting') : t('evm.connect') }}
          </button>
        </template>
        <StatusMessage v-if="evmMsg" class="mt-3" :tone="evmMsg.tone" :text="evmMsg.text" />

        <div class="mt-4 pt-3 border-t border-neutral-300">
          <p v-if="session.nimAddress" class="text-sm">
            <span class="font-semibold">{{ t('nim.title') }}</span>
            <span v-if="session.nimBalance !== null">
              · {{ nimDisplay(session.nimBalance) }} NIM</span
            >
            <span class="block font-mono text-xs text-neutral-700 mt-1">{{
              session.nimAddress
            }}</span>
          </p>
          <button v-else type="button" class="btn-ghost" :disabled="nimBusy" @click="showNim">
            {{ nimBusy ? t('evm.connecting') : t('nim.show') }}
          </button>
          <StatusMessage v-if="nimMsg" class="mt-2" :tone="nimMsg.tone" :text="nimMsg.text" />
        </div>
      </section>

      <nav class="flex flex-col gap-3 mb-4" :aria-label="t('app.name')">
        <button type="button" class="tile tile-primary" @click="startCashout('self')">
          <span class="tile-icon bg-white/20"
            ><span class="i-nimiq:arrow-from-bottom-right" aria-hidden="true"
          /></span>
          <span class="flex-1 text-left">
            <span class="block font-bold text-lg">{{ t('home.cashOut') }}</span>
            <span class="block text-sm opacity-90">{{ t('home.cashOutHint') }}</span>
          </span>
          <span class="i-nimiq:chevron-right" aria-hidden="true" />
        </button>
        <button type="button" class="tile" @click="startCashout('other')">
          <span class="tile-icon bg-green-400 text-green-1100"
            ><span class="i-nimiq:globe" aria-hidden="true"
          /></span>
          <span class="flex-1 text-left">
            <span class="block font-bold">{{ t('home.send') }}</span>
            <span class="block text-sm text-neutral-800">{{ t('home.sendHint') }}</span>
          </span>
          <span class="i-nimiq:chevron-right text-neutral-700" aria-hidden="true" />
        </button>
        <RouterLink to="/history" class="tile">
          <span class="tile-icon bg-neutral-300 text-neutral-1100"
            ><span class="i-nimiq:sand-clock" aria-hidden="true"
          /></span>
          <span class="flex-1 text-left">
            <span class="block font-bold">{{ t('home.history') }}</span>
            <span class="block text-sm text-neutral-800">{{ t('home.historyHint') }}</span>
          </span>
          <span class="i-nimiq:chevron-right text-neutral-700" aria-hidden="true" />
        </RouterLink>
      </nav>

      <p class="text-sm text-neutral-800 text-center px-2">{{ t('home.countries') }}</p>
      <p class="text-sm text-neutral-800 text-center px-2 mt-1">{{ t('home.promise') }}</p>

      <nav v-if="SPIKES_ENABLED" class="card mt-6" aria-label="Spikes">
        <h2 class="card-title">Phase 0 spikes</h2>
        <RouterLink class="btn-secondary mb-2" to="/spike/s2">S2 · Gasless $1</RouterLink>
        <RouterLink class="btn-secondary mb-2" to="/spike/s3">S3 · Lightning</RouterLink>
        <RouterLink class="btn-secondary" to="/spike/s4">S4 · Nimiq sign-in</RouterLink>
      </nav>
    </template>
  </main>
</template>
