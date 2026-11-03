<script setup lang="ts">
// Sits above Fonbnk's buy form. Fonbnk asks to connect a wallet over WalletConnect; the user copies
// its link, pastes it here, and Ferry answers as the wallet (see lib/wcBridge.ts).
import type { WalletKitTypes } from '@reown/walletkit'
import { hexToString, isHex, type Address, type Hex } from 'viem'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  answer,
  approve,
  fromFonbnk,
  isSignMethod,
  parseWcLink,
  refuse,
  reject,
  walletKit,
} from '../lib/wcBridge'
import { classifyEvmError, evmErrorText, personalSign, signTypedDataV4 } from '../providers/evm'
import Icon from './Icon.vue'

const props = defineProps<{ address: Address }>()
const { t } = useI18n()

const PAIR_TIMEOUT_MS = 45_000

const state = ref<'idle' | 'pairing' | 'connected'>('idle')
const linkInput = ref('')
const showInput = ref(false)
const notice = ref('')
const problem = ref('')
const busy = ref(false)
const proposal = ref<WalletKitTypes.SessionProposal | null>(null)
const request = ref<WalletKitTypes.SessionRequest | null>(null)

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

type Kit = Awaited<ReturnType<typeof walletKit>>
let kit: Kit | null = null
let pairTimer: ReturnType<typeof setTimeout> | undefined

function onProposal(p: WalletKitTypes.SessionProposal) {
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
  const { method, params } = r.params.request
  const target = (params as { chainId?: string }[] | undefined)?.[0]?.chainId
  if (method === 'wallet_switchEthereumChain' && target?.toLowerCase() === '0x89') {
    void answer(r, null).catch(() => undefined) // already on Polygon
    return
  }
  if (!isSignMethod(method)) {
    void refuse(r).catch(() => undefined)
    notice.value = t('wc.refusedTx')
    return
  }
  request.value = r
}

function onDelete() {
  state.value = 'idle'
  notice.value = t('wc.disconnected')
}

onMounted(async () => {
  try {
    kit = await walletKit()
    kit.on('session_proposal', onProposal)
    kit.on('session_request', onRequest)
    kit.on('session_delete', onDelete)
    if (Object.keys(kit.getActiveSessions()).length) state.value = 'connected'
  } catch (err) {
    problem.value = t('wc.failed', { reason: reason(err) })
  }
})
onUnmounted(() => {
  clearTimeout(pairTimer)
  kit?.off('session_proposal', onProposal)
  kit?.off('session_request', onRequest)
  kit?.off('session_delete', onDelete)
})

async function pairWith(text: string) {
  problem.value = ''
  notice.value = ''
  const link = parseWcLink(text)
  if (!link) {
    problem.value = t('wc.badLink')
    showInput.value = true
    return
  }
  state.value = 'pairing'
  linkInput.value = ''
  try {
    kit ??= await walletKit()
    await kit.pair({ uri: link })
    pairTimer = setTimeout(() => {
      if (state.value === 'pairing' && !proposal.value) {
        state.value = 'idle'
        problem.value = t('wc.noAnswer')
      }
    }, PAIR_TIMEOUT_MS)
  } catch (err) {
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
}

function onInput() {
  if (parseWcLink(linkInput.value)) void pairWith(linkInput.value)
}

// ---- Sharing the address: one tap, no wallet prompt (Nimiq Pay already gave Ferry the address) ----

async function share() {
  const p = proposal.value
  if (!p) return
  busy.value = true
  try {
    await approve(p, props.address)
    proposal.value = null
    state.value = 'connected'
  } catch (err) {
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
      <span class="s-wc__text">{{ t('wc.connected', { address: short(address) }) }}</span>
    </template>
    <template v-else-if="state === 'pairing'">
      <span class="s-wc__text">{{ t('wc.connecting') }}</span>
    </template>
    <template v-else>
      <span class="s-wc__text">
        <strong>{{ t('wc.title') }}</strong>
        <span>{{ t('wc.steps') }}</span>
      </span>
      <button type="button" class="fy-btn fy-btn--primary fy-btn--sm" @click="pasteLink">
        <Icon name="copy" :size="16" />{{ t('wc.paste') }}
      </button>
    </template>
  </section>
  <div v-if="showInput && state === 'idle'" class="s-wc__input">
    <input
      v-model="linkInput"
      :aria-label="t('wc.paste')"
      placeholder="wc:…"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @input="onInput"
    />
  </div>
  <p v-if="problem" class="s-wc__msg s-wc__msg--bad" role="alert">{{ problem }}</p>
  <p v-else-if="notice" class="s-wc__msg">{{ notice }}</p>

  <Teleport to="body">
    <div v-if="proposal" class="sheet-backdrop" role="presentation">
      <section class="sheet s-wcsheet" role="dialog" aria-modal="true" aria-labelledby="wc-share">
        <h2 id="wc-share" class="s-wcsheet__title">{{ t('wc.proposalTitle') }}</h2>
        <p class="s-wcsheet__body">{{ t('wc.proposalBody') }}</p>
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
.s-wc__input {
  margin: 0 16px 8px;
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
