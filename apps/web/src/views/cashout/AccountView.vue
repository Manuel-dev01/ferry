<script setup lang="ts">
import { accountKind, normalizeAccountIdentifier, phoneExample } from '@ferry/shared'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import BottomAction from '../../components/BottomAction.vue'
import Monogram from '../../components/Monogram.vue'
import StatusMessage from '../../components/StatusMessage.vue'
import TopBar from '../../components/TopBar.vue'
import { MOCK_WALLET } from '../../config'
import { errorCode, errorRef } from '../../lib/api'
import { ferryApi } from '../../lib/ferryApi'
import { useCashoutStore } from '../../stores/cashout'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()

const institution = computed(() => draft.institution!)
const kind = computed(() => accountKind(draft.currency!, institution.value.type))
const normalized = computed(() =>
  normalizeAccountIdentifier(draft.currency!, institution.value.type, draft.accountInput),
)
const touched = ref(false)
const busy = ref(false)
const error = ref<{ text: string; ref?: string } | null>(null)

const label = computed(() => t(`account.${kind.value}`))
const hint = computed(() =>
  kind.value === 'nuban'
    ? t('account.nubanHint')
    : kind.value === 'phone'
      ? t('account.phoneHint', { example: phoneExample(draft.currency!) })
      : '',
)
const invalidText = computed(() =>
  kind.value === 'nuban'
    ? t('account.invalidNuban')
    : kind.value === 'phone'
      ? t('account.invalidPhone')
      : t('account.invalidAccount'),
)
const showInvalid = computed(() => touched.value && draft.accountInput !== '' && !normalized.value)

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  // NUBANs are digits only: drop anything else as the user types or pastes.
  draft.accountInput = kind.value === 'nuban' ? raw.replace(/\D/g, '').slice(0, 10) : raw
  error.value = null
  draft.accountName = null
}

async function check() {
  touched.value = true
  if (!normalized.value) return
  busy.value = true
  error.value = null
  try {
    const res = await ferryApi.verifyAccount(
      draft.currency!,
      institution.value.code,
      normalized.value,
    )
    draft.accountIdentifier = normalized.value
    draft.accountName = res.accountName
    draft.accountMasked = res.masked
    void router.push('/cashout/confirm')
  } catch (err) {
    const code = errorCode(err)
    error.value = {
      text:
        code === 'ACCOUNT_NOT_FOUND'
          ? t('account.notFound', { institution: institution.value.name })
          : code === 'NAME_CHECK_UNAVAILABLE'
            ? t('account.unavailable')
            : code === 'OFFLINE'
              ? t('errors.offline')
              : t('account.unavailable'),
      ref: errorRef(err),
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="page">
    <TopBar
      :title="draft.recipientKind === 'other' ? t('account.titleOther') : t('account.title')"
      :step="3"
      :steps="5"
      back="/cashout/bank"
    />

    <div class="card flex items-center gap-3">
      <Monogram :name="institution.name" />
      <span class="flex-1 font-semibold">{{ institution.name }}</span>
      <RouterLink to="/cashout/bank" class="link text-sm">{{ t('common.edit') }}</RouterLink>
    </div>

    <form class="card" novalidate @submit.prevent="check">
      <label class="label" for="account-input">{{ label }}</label>
      <input
        id="account-input"
        class="input text-lg tracking-wide"
        :class="{ 'input-invalid': showInvalid }"
        :value="draft.accountInput"
        :inputmode="kind === 'account' ? 'text' : 'numeric'"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        :aria-invalid="showInvalid"
        :aria-describedby="showInvalid ? 'account-error' : hint ? 'account-hint' : undefined"
        @input="onInput"
        @blur="touched = true"
      />
      <p v-if="showInvalid" id="account-error" class="text-sm text-red-1100 mt-2">
        {{ invalidText }}
      </p>
      <p v-else-if="hint" id="account-hint" class="text-sm text-neutral-800 mt-2">{{ hint }}</p>
      <p v-if="MOCK_WALLET" class="text-xs text-gold-1100 mt-3">{{ t('account.devHint') }}</p>
    </form>

    <StatusMessage v-if="error" tone="error" :text="error.text" :support-ref="error.ref" />

    <BottomAction>
      <button type="button" class="btn-primary" :disabled="busy || !normalized" @click="check">
        {{ busy ? t('account.checking') : t('account.check') }}
      </button>
    </BottomAction>
  </main>
</template>
