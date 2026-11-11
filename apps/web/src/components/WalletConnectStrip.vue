<script setup lang="ts">
// Sits above Fonbnk's buy and sell forms. Fonbnk asks to connect a wallet over WalletConnect; the
// user copies its link, pastes it here, and Ferry answers as the wallet (see lib/wcBridge.ts). With
// `pay` (cash-out), Fonbnk's USDT payment request is handed to the page as a `pay` event.
import type { WalletKitTypes } from '@reown/walletkit'
import { hexToString, isHex, type Address, type Hex } from 'viem'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  answer,
  approve,
  fail,
  fromFonbnk,
  isSignMethod,
  parseUsdtPayment,
  parseWcLink,
  refuse,
  reject,
  walletKit,
  wcLinkExpired,
  type WcPayment,
} from '../lib/wcBridge'
import { classifyEvmError, evmErrorText, personalSign, signTypedDataV4 } from '../providers/evm'
import Icon from './Icon.vue'

const props = defineProps<{ address: Address; pay?: boolean }>()
const emit = defineEmits<{ pay: [payment: WcPayment] }>()
const { t, te } = useI18n()
/** Copy for the current job: cash-out wording under wc.pay, falling back to the buy wording. */
const wt = (key: string, values: Record<string, unknown> = {}) =>
  props.pay && te(`wc.pay.${key}`) ? t(`wc.pay.${key}`, values) : t(`wc.${key}`, values)

const PAIR_TIMEOUT_MS = 45_000

const state = ref<'idle' | 'pairing' | 'connected'>('idle')
const linkInput = ref('')
const showInput = ref(false)
const pasteOpen = computed(() => showInput.value && state.value === 'idle')
const linkEl = ref<HTMLInputElement | null>(null)
const notice = ref('')
const problem = ref('')
const busy = ref(false)
const proposal = ref<WalletKitTypes.SessionProposal | null>(null)
const request = ref<WalletKitTypes.SessionRequest | null>(null)
/**
 * Fonbnk's payment requests while the page shows them, keyed by the first request's id. Fonbnk can
 * ask again for the same payment; repeats join the first and get the same answer, never a refusal.
 */
type PendingPayment = { to: Address; units: bigint; requests: WalletKitTypes.SessionRequest[] }
const payments = new Map<number, PendingPayment>()
/** Requests that can arrive while the address is being shared; more than this are refused. */
const EARLY_MAX = 16

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

type Kit = Awaited<ReturnType<typeof walletKit>>
let kit: Kit | null = null
let disposed = false
const sessionTopic = ref<string | null>(null)
let pairTimer: ReturnType<typeof setTimeout> | undefined
let pairGeneration = 0
let pairingTopic: string | null = null
let listening = false
const earlyRequests: WalletKitTypes.SessionRequest[] = []

function onProposal(p: WalletKitTypes.SessionProposal) {
  if (
    disposed ||
    state.value !== 'pairing' ||
    proposal.value ||
    (p.params?.pairingTopic && p.params.pairingTopic !== pairingTopic)
  ) {
    void reject(p).catch(() => undefined)
    return
  }
  clearTimeout(pairTimer)
  if (!fromFonbnk(p)) {
    void reject(p).catch(() => undefined)
    state.value = 'idle'
    problem.value = t('wc.notFonbnk')
    return
  }
  proposal.value = p
}

function onRequest(r: WalletKitTypes.SessionRequest) {
  if (!sessionTopic.value && busy.value && proposal.value && earlyRequests.length < EARLY_MAX) {
    earlyRequests.push(r)
    return
  }
  if (r.topic !== sessionTopic.value) {
    void refuse(r).catch(() => undefined)
    return
  }
  const { method, params } = r.params.request
  if (method === 'eth_chainId') {
    void answer(r, '0x89').catch(() => undefined)
    return
  }
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
    void answer(r, [props.address]).catch(() => undefined)
    return
  }
  const target = (params as { chainId?: string }[] | undefined)?.[0]?.chainId
  if (method === 'wallet_switchEthereumChain') {
    if (target?.toLowerCase() === '0x89') {
      void answer(r, null).catch(() => undefined) // already on Polygon
    } else {
      // Ferry pays on Polygon only. 4902 (unknown chain) rather than "user rejected"
      void fail(r, 4902, 'Ferry pays on Polygon only').catch(() => undefined)
      notice.value = `${t('wc.otherNetwork')} [${method} ${target ?? '?'}]`
    }
    return
  }
  if (props.pay && method === 'eth_sendTransaction') return onPayment(r)
  if (r.params.chainId !== 'eip155:137' || request.value || !isSignMethod(method)) {
    void refuse(r).catch(() => undefined)
    notice.value = `${wt('refusedTx')} [${method} ${r.params.chainId}]`
    return
  }
  request.value = r
}

function onPayment(r: WalletKitTypes.SessionRequest) {
  const asked = (r.params.request.params as unknown[] | undefined)?.[0]
  const parsed =
    r.params.chainId === 'eip155:137' && !request.value
      ? parseUsdtPayment(asked, props.address)
      : null
  if (!parsed) {
    void refuse(r).catch(() => undefined)
    notice.value = `${t('wc.pay.unsupported')} [${r.params.chainId}]`
    return
  }
  for (const p of payments.values()) {
    if (p.to === parsed.to && p.units === parsed.units) {
      p.requests.push(r)
      return
    }
  }
  payments.set(r.id, { ...parsed, requests: [r] })
  emit('pay', { ...parsed, settle: (hash) => settle(r.id, hash) })
}

/** Answers every request for one payment: the hash, or a refusal. False if Fonbnk wasn't told. */
async function settle(id: number, hash: Hex | null): Promise<boolean> {
  const p = payments.get(id)
  if (!p) return false
  payments.delete(id)
  const told = await Promise.allSettled(p.requests.map((r) => (hash ? answer(r, hash) : refuse(r))))
  return told.some((x) => x.status === 'fulfilled')
}

function onDelete(event: { topic: string }) {
  if (event.topic !== sessionTopic.value) return
  sessionTopic.value = null
  request.value = null
  refusePayments()
  state.value = 'idle'
  notice.value = t('wc.disconnected')
}

async function ensureKit() {
  kit ??= await walletKit()
  if (disposed) throw new Error('Connection screen closed')
  if (!listening) {
    kit.on('session_proposal', onProposal)
    kit.on('session_request', onRequest)
    kit.on('session_delete', onDelete)
    listening = true
  }
  return kit
}
onUnmounted(() => {
  disposed = true
  void resetConnection()
  clearTimeout(pairTimer)
  kit?.off('session_proposal', onProposal)
  kit?.off('session_request', onRequest)
  kit?.off('session_delete', onDelete)
})

function refusePayments() {
  const pending = [...payments.values()].flatMap((p) => p.requests)
  payments.clear()
  for (const r of pending) void refuse(r).catch(() => undefined)
}

async function resetConnection() {
  pairGeneration++
  pairingTopic = null
  for (const r of earlyRequests.splice(0)) void refuse(r).catch(() => undefined)
  clearTimeout(pairTimer)
  const topic = sessionTopic.value
  sessionTopic.value = null
  state.value = 'idle'
  const pendingProposal = proposal.value
  const pendingRequest = request.value
  proposal.value = null
  request.value = null
  refusePayments()
  if (pendingProposal) void reject(pendingProposal).catch(() => undefined)
  if (pendingRequest) void refuse(pendingRequest).catch(() => undefined)
  if (topic && kit) {
    await kit
      .disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected' } })
      .catch(() => undefined)
  }
}

/** `openPaste` only when the user tapped Reconnect; otherwise the notice says what to do. */
async function reconnect(openPaste = true) {
  await resetConnection()
  showInput.value = openPaste
  notice.value = t('wc.disconnected')
}

function closePaste() {
  showInput.value = false
  linkInput.value = ''
  problem.value = ''
}

watch(
  () => props.address,
  () => {
    void reconnect(false)
  },
)

async function pairWith(text: string) {
  if (state.value === 'pairing' || busy.value || disposed) return
  clearTimeout(pairTimer)
  problem.value = ''
  notice.value = ''
  const link = parseWcLink(text)
  if (!link) {
    problem.value = t('wc.badLink')
    showInput.value = true
    return
  }
  if (wcLinkExpired(link)) {
    problem.value = t('wc.expiredLink')
    showInput.value = true
    return
  }
  const generation = ++pairGeneration
  pairingTopic = link.slice(3, link.indexOf('@'))
  state.value = 'pairing'
  showInput.value = false
  linkInput.value = ''
  try {
    kit = await ensureKit()
    if (disposed || generation !== pairGeneration) return
    pairTimer = setTimeout(() => {
      if (generation === pairGeneration && state.value === 'pairing' && !proposal.value) {
        pairGeneration++
        pairingTopic = null
        state.value = 'idle'
        problem.value = t('wc.noAnswer')
      }
    }, PAIR_TIMEOUT_MS)
    await kit.pair({ uri: link })
  } catch (err) {
    if (disposed || generation !== pairGeneration) return
    clearTimeout(pairTimer)
    state.value = 'idle'
    problem.value = t('wc.failed', { reason: reason(err) })
  }
}

async function pasteLink() {
  try {
    const text = await navigator.clipboard.readText()
    if (text.trim()) return await pairWith(text)
  } catch {
    // clipboard blocked: the box below takes a long-press paste
  }
  showInput.value = true
  // Focusing opens the keyboard, which on Android offers the copied link as a suggestion
  await nextTick()
  linkEl.value?.focus()
}

function onInput() {
  problem.value = ''
}

// ---- Sharing the address: one tap, no wallet prompt (Nimiq Pay already gave Ferry the address) ----

async function share() {
  const p = proposal.value
  if (!p) return
  busy.value = true
  try {
    const session = await approve(p, props.address)
    if (disposed || proposal.value?.id !== p.id) {
      await kit?.disconnectSession({
        topic: session.topic,
        reason: { code: 6000, message: 'Flow closed' },
      })
      return
    }
    sessionTopic.value = session.topic
    proposal.value = null
    state.value = 'connected'
    for (const r of earlyRequests.splice(0)) onRequest(r)
  } catch (err) {
    for (const r of earlyRequests.splice(0)) void refuse(r).catch(() => undefined)
    proposal.value = null
    state.value = 'idle'
    problem.value = t('wc.failed', { reason: reason(err) })
  } finally {
    busy.value = false
  }
}

async function decline() {
  const p = proposal.value
  proposal.value = null
  state.value = 'idle'
  if (p) await reject(p).catch(() => undefined)
}

// ---- Sign-in requests: shown here first, then one approval in Nimiq Pay ----

const signText = computed(() => {
  const r = request.value
  if (!r) return ''
  const p = r.params.request.params as unknown[]
  if (r.params.request.method === 'personal_sign') {
    const m = String(p[0] ?? '')
    if (!isHex(m)) return m
    try {
      return hexToString(m)
    } catch {
      return m
    }
  }
  try {
    const td = JSON.parse(String(p[1] ?? '{}')) as {
      domain?: { name?: string }
      primaryType?: string
    }
    return [td.domain?.name, td.primaryType].filter(Boolean).join(' · ')
  } catch {
    return ''
  }
})

async function sign() {
  const r = request.value
  if (!r) return
  const { method, params } = r.params.request
  const p = params as unknown[]
  const signer = String((method === 'personal_sign' ? p[1] : p[0]) ?? '')
  busy.value = true
  try {
    if (signer.toLowerCase() !== props.address.toLowerCase()) {
      await refuse(r)
      request.value = null
      problem.value = t('wc.wrongAccount')
      return
    }
    const signature =
      method === 'personal_sign'
        ? await personalSign(props.address, p[0] as Hex)
        : await signTypedDataV4(props.address, JSON.parse(String(p[1])))
    await answer(r, signature)
    request.value = null
  } catch (err) {
    if (classifyEvmError(err) === 'rejected') {
      await refuse(r).catch(() => undefined)
      request.value = null
      notice.value = t('wc.signDeclined')
    } else {
      problem.value = t('wc.failed', { reason: evmErrorText(err) })
    }
  } finally {
    busy.value = false
  }
}

async function declineSign() {
  const r = request.value
  request.value = null
  if (r) await refuse(r).catch(() => undefined)
}
</script>

<template>
  <section class="s-wc" aria-live="polite">
    <template v-if="state === 'connected'">
      <span class="s-wc__ok"><Icon name="check" :size="16" :stroke="3" /></span>
      <span class="s-wc__text">{{ wt('connected', { address: short(address) }) }}</span>
      <button
        type="button"
        class="fy-btn fy-btn--secondary fy-btn--sm"
        :disabled="busy"
        @click="reconnect()"
      >
        {{ t('wc.reconnect') }}
      </button>
    </template>
    <template v-else-if="state === 'pairing'">
      <span class="s-wc__text">{{ t('wc.connecting') }}</span>
      <button type="button" class="fy-btn fy-btn--secondary fy-btn--sm" @click="reconnect(false)">
        {{ t('wc.notNow') }}
      </button>
    </template>
    <template v-else>
      <span class="s-wc__text">
        <strong>{{ wt('title') }}</strong>
        <span>{{ t('wc.where') }}</span>
      </span>
      <button type="button" class="fy-btn fy-btn--primary fy-btn--sm" @click="pasteLink">
        <Icon name="copy" :size="16" />{{ t('wc.paste') }}
      </button>
    </template>
  </section>
  <details v-if="state === 'idle'" class="s-wc__help">
    <summary>{{ t('wc.help') }}</summary>
    <p>{{ wt('steps') }}</p>
  </details>
  <p v-if="problem && !pasteOpen" class="s-wc__msg s-wc__msg--bad" role="alert">{{ problem }}</p>
  <p v-else-if="notice && !pasteOpen" class="s-wc__msg">{{ notice }}</p>

  <Teleport to="body">
    <!-- A sheet, not an inline box: growing the strip pushed Fonbnk's frame down and clipped the
         top of its wallet list, where the QR icon is (seen on a phone 2026-11-11) -->
    <div v-if="pasteOpen" class="sheet-backdrop" role="presentation">
      <section class="sheet s-wcsheet" role="dialog" aria-modal="true" aria-labelledby="wc-paste">
        <h2 id="wc-paste" class="s-wcsheet__title">{{ t('wc.pasteTitle') }}</h2>
        <p class="s-wcsheet__body">{{ t('wc.pasteBody') }}</p>
        <div class="s-wc__input">
          <span class="fy-help">{{ t('wc.pasteHint') }}</span>
          <input
            ref="linkEl"
            v-model="linkInput"
            :aria-label="t('wc.paste')"
            placeholder="wc:…"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @input="onInput"
            @keydown.enter="pairWith(linkInput)"
          />
        </div>
        <p v-if="problem" class="s-wc__msg s-wc__msg--bad" role="alert">{{ problem }}</p>
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :disabled="!linkInput.trim() || busy"
          @click="pairWith(linkInput)"
        >
          {{ t('wc.connectLink') }}
        </button>
        <button type="button" class="fy-btn fy-btn--secondary" @click="closePaste">
          {{ t('wc.cancel') }}
        </button>
      </section>
    </div>
    <div v-if="proposal" class="sheet-backdrop" role="presentation">
      <section class="sheet s-wcsheet" role="dialog" aria-modal="true" aria-labelledby="wc-share">
        <h2 id="wc-share" class="s-wcsheet__title">{{ t('wc.proposalTitle') }}</h2>
        <p class="s-wcsheet__body">{{ wt('proposalBody') }}</p>
        <p class="s-wcsheet__mono">{{ address }}</p>
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy"
          @click="share"
        >
          {{ t('wc.share') }}
        </button>
        <button type="button" class="fy-btn fy-btn--secondary" :disabled="busy" @click="decline">
          {{ t('wc.notNow') }}
        </button>
      </section>
    </div>
    <div v-if="request" class="sheet-backdrop" role="presentation">
      <section class="sheet s-wcsheet" role="dialog" aria-modal="true" aria-labelledby="wc-sign">
        <h2 id="wc-sign" class="s-wcsheet__title">{{ t('wc.signTitle') }}</h2>
        <p class="s-wcsheet__body">{{ t('wc.signBody') }}</p>
        <pre v-if="signText" class="s-wcsheet__msg">{{ signText }}</pre>
        <button
          type="button"
          class="fy-btn fy-btn--primary"
          :class="{ 'fy-btn--busy': busy }"
          :disabled="busy"
          @click="sign"
        >
          {{ t('wc.sign') }}
        </button>
        <button
          type="button"
          class="fy-btn fy-btn--secondary"
          :disabled="busy"
          @click="declineSign"
        >
          {{ t('wc.decline') }}
        </button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.s-wc {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 8px;
  padding: 10px 10px 10px 14px;
  border-radius: var(--fy-radius-m);
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
}
.s-wc__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13.5px;
  line-height: 1.35;
  color: var(--fy-ink-2);
}
.s-wc__text strong {
  font-size: 14.5px;
  color: var(--fy-ink);
}
.s-wc__ok {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--fy-brand-soft);
  color: var(--fy-brand);
}
.s-wc__help {
  margin: 0 16px 8px;
  font-size: 13px;
  color: var(--fy-ink-2);
}
.s-wc__help summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  text-decoration: underline;
}
.s-wc__help p {
  margin: 0 0 8px;
  line-height: 1.5;
}
.s-wc__input {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.s-wcsheet .s-wc__msg {
  margin: 0;
}
.s-wc__input input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: var(--fy-radius-m);
  border: 1.5px solid var(--fy-line);
  background: var(--fy-surface);
  color: var(--fy-ink);
  font:
    500 14px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.s-wc__msg {
  margin: 0 16px 8px;
  font-size: 13px;
  color: var(--fy-ink-2);
}
.s-wc__msg--bad {
  color: var(--fy-danger, #c2410c);
}
.s-wcsheet {
  background: var(--fy-surface);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.s-wcsheet__title {
  margin: 0;
  font: 800 20px/1.2 var(--fy-font-display);
  letter-spacing: -0.02em;
  color: var(--fy-ink);
}
.s-wcsheet__body {
  margin: 0;
  font-size: 14.5px;
  color: var(--fy-ink-2);
}
.s-wcsheet__mono,
.s-wcsheet__msg {
  margin: 0 0 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--fy-surface-2);
  color: var(--fy-ink);
  font:
    500 13px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  word-break: break-all;
  white-space: pre-wrap;
  max-height: 180px;
  overflow: auto;
}
</style>
