<script setup lang="ts">
import './spike.css'
import type { SpikeNimVerifyResponse } from '@ferry/shared'
import { ref } from 'vue'
import StatusMessage from '../../components/StatusMessage.vue'
import StepLog from '../../components/StepLog.vue'
import { useStepLog } from '../../composables/useStepLog'
import { api, ApiRequestError } from '../../lib/api'
import { classifyNimiqError } from '../../providers/nimiq'
import { useSessionStore } from '../../stores/session'

const session = useSessionStore()
const log = useStepLog()
const busy = ref(false)
const result = ref<SpikeNimVerifyResponse | null>(null)

const sameAddress = (a: string, b: string) =>
  a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase()

async function signIn() {
  const nimiq = session.nimiq
  if (!nimiq) return
  busy.value = true
  result.value = null
  try {
    const { challenge } = await api<{ challenge: string }>('/spike/nim/challenge')
    log.add('Asking Nimiq Pay to sign the challenge…')
    let signed: { publicKey: string; signature: string }
    try {
      signed = await nimiq.sign(challenge)
    } catch (err) {
      const e = classifyNimiqError(err)
      log.add(e.kind === 'rejected' ? 'Sign-in cancelled.' : `Sign failed (${e.type}).`, 'warn')
      return
    }
    log.add(`Signed ✓ public key ${signed.publicKey.slice(0, 12)}…`, 'success')
    result.value = await api<SpikeNimVerifyResponse>('/spike/nim/verify', {
      method: 'POST',
      body: { challenge, publicKey: signed.publicKey, signature: signed.signature },
    })
    if (!result.value.valid)
      log.add('Server could not verify the signature with either format.', 'error')
    else {
      log.add(
        `Verified ✓ format: ${result.value.scheme}. Address ${result.value.address}`,
        'success',
      )
      if (session.nimAddress) {
        const match = sameAddress(result.value.address ?? '', session.nimAddress)
        log.add(
          match
            ? 'Matches your listAccounts address ✓'
            : 'Does NOT match your listAccounts address',
          match ? 'success' : 'error',
        )
      } else log.add('Tip: tap "Show my NIM" on Home first to compare addresses.')
    }
  } catch (err) {
    log.add(
      `Error: ${err instanceof ApiRequestError ? `${err.message} (${err.code})` : String(err)}`,
      'error',
    )
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <RouterLink to="/" class="link mb-4 inline-block">← Home</RouterLink>
    <h1 class="text-xl font-bold mb-1">S4 · Nimiq sign-in</h1>
    <p class="muted mb-4">
      Sign a one-time challenge. The server checks it and works out your address from the public
      key.
    </p>
    <StatusMessage
      v-if="session.status !== 'ready'"
      tone="warn"
      text="Open this inside Nimiq Pay."
    />
    <section class="card">
      <button
        type="button"
        class="btn-primary"
        :disabled="busy || session.status !== 'ready'"
        @click="signIn"
      >
        {{ busy ? 'Working…' : 'Sign in with Nimiq' }}
      </button>
      <StepLog :entries="log.entries.value" />
    </section>
  </main>
</template>
