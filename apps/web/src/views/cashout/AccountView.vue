<script setup lang="ts">
import { accountKind, normalizeAccountIdentifier, phoneExample } from '@ferry/shared'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '../../components/AppHeader.vue'
import Icon from '../../components/Icon.vue'
import Monogram from '../../components/Monogram.vue'
import { MOCK_WALLET } from '../../config'
import { errorCode, errorRef } from '../../lib/api'
import { COUNTRY_NAMES, DIAL_CODES, FLAGS } from '../../lib/corridors'
import { ferryApi } from '../../lib/ferryApi'
import { groupDigits } from '../../lib/names'
import { useCashoutStore } from '../../stores/cashout'

const { t } = useI18n()
const router = useRouter()
const draft = useCashoutStore()

const currency = computed(() => draft.currency!)
const institution = computed(() => draft.institution!)
const kind = computed(() => accountKind(currency.value, institution.value.type))
const normalized = computed(() =>
  normalizeAccountIdentifier(currency.value, institution.value.type, draft.accountInput),
)
const busy = ref(false)
const touched = ref(false)
const error = ref<{ text: string; ref?: string } | null>(null)

/** What the field shows: digits grouped as you type. */
const display = computed(() => {
  const raw = draft.accountInput
  if (kind.value === 'nuban') return groupDigits(raw, [3, 3, 4])
  if (kind.value === 'phone') return groupDigits(raw, raw.startsWith('0') ? [4, 3, 3] : [3, 3, 3])
  return raw
})

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  draft.accountInput =
    kind.value === 'nuban'
      ? raw.replace(/\D/g, '').slice(0, 10)
      : kind.value === 'phone'
        ? raw.replace(/\D/g, '').slice(0, 12)
        : raw.replace(/\s/g, '').slice(0, 24)
  error.value = null
  draft.accountName = null
}

const helper = computed<{ text: string; tone: '' | 'error' | 'success' }>(() => {
  if (error.value) return { text: error.value.text, tone: 'error' }
  if (busy.value)
    return { text: t('account.checking', { institution: institution.value.name }), tone: '' }
  const raw = draft.accountInput
  if (kind.value === 'nuban') {
    if (raw.length === 10) return { text: t('account.nubanOk'), tone: 'success' }
    return { text: t('account.nubanToGo', { n: 10 - raw.length }), tone: '' }
  }
  if (kind.value === 'phone') {
    if (normalized.value) return { text: t('account.phoneOk'), tone: 'success' }
    if (touched.value && raw.length >= 9)
      return {
        text: t('account.invalidPhone', { country: COUNTRY_NAMES[currency.value] }),
        tone: 'error',
      }
    return { text: t('account.phoneHelp', { example: phoneExample(currency.value) }), tone: '' }
  }
  if (touched.value && raw && !normalized.value)
    return { text: t('account.invalidAccount'), tone: 'error' }
  return { text: '', tone: '' }
})

async function check() {
  touched.value = true
  if (!normalized.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await ferryApi.verifyAccount(
      currency.value,
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
  <main class="fy-screen">
    <AppHeader back="/cashout/bank">{{ t('common.step', { step: 3, steps: 4 }) }}</AppHeader>
    <div class="fy-content" style="gap: 22px">
      <div
        class="self-start flex items-center gap-2.5"
        style="
          height: 48px;
          padding: 0 6px;
          border-radius: 999px;
          background: var(--fy-surface);
          box-shadow: inset 0 0 0 1px var(--fy-line);
        "
      >
        <Monogram :name="institution.name" :seed="institution.code" size="sm" />
        <span style="font: 600 15px var(--fy-font-body)">{{ institution.name }}</span>
        <RouterLink
          to="/cashout/bank"
          class="fy-btn fy-btn--text fy-btn--sm"
          style="min-height: 36px; padding: 0 12px; font-size: 14px"
        >
          {{ t('common.change') }}
        </RouterLink>
      </div>

      <h1 class="fy-display">
        {{ draft.recipientKind === 'other' ? t('account.titleOther') : t('account.title') }}
      </h1>

      <form class="flex flex-col gap-2" novalidate @submit.prevent="check">
        <label class="fy-label" for="account-input">{{ t(`account.${kind}`) }}</label>
        <div class="fy-field" :class="{ 'fy-field--error': helper.tone === 'error' }">
          <template v-if="kind === 'phone'">
            <span class="fy-field__prefix">{{ FLAGS[currency] }} +{{ DIAL_CODES[currency] }}</span>
            <span class="fy-field__sep" />
          </template>
          <input
            id="account-input"
            :value="display"
            :inputmode="kind === 'account' ? 'text' : 'numeric'"
            :placeholder="kind === 'nuban' ? t('account.nubanPlaceholder') : ''"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            :aria-invalid="helper.tone === 'error'"
            aria-describedby="account-help"
            :readonly="busy"
            @input="onInput"
            @blur="touched = true"
          />
          <template v-if="busy">
            <span class="fy-field__status">{{ t('account.checkingShort') }}</span>
            <span class="fy-shimmer-line" />
          </template>
          <span v-else-if="helper.tone === 'success'" class="fy-field__ok"
            ><Icon name="check" :size="15" :stroke="3"
          /></span>
          <Icon
            v-else-if="helper.tone === 'error'"
            name="alert"
            :size="22"
            style="color: var(--fy-danger)"
          />
        </div>
        <p
          id="account-help"
          class="fy-help"
          :class="helper.tone && `fy-help--${helper.tone}`"
          aria-live="polite"
        >
          {{ helper.text }}
          <span v-if="error?.ref" style="display: block; color: var(--fy-ink-2)">{{
            t('errors.ref', { ref: error.ref })
          }}</span>
        </p>
      </form>

      <p class="fy-note"><Icon name="shield" :size="18" />{{ t('account.note') }}</p>
      <p v-if="MOCK_WALLET" class="fy-caption" style="color: var(--fy-warning)">
        {{ t('account.devHint') }}
      </p>
    </div>

    <div class="fy-bottom">
      <button
        type="button"
        class="fy-btn fy-btn--primary"
        :class="{ 'fy-btn--busy': busy }"
        :disabled="busy || !normalized"
        @click="check"
      >
        {{ busy ? t('account.checkingShort') : t('common.continue') }}
        <span v-if="busy" class="fy-btn__progress" />
      </button>
    </div>
  </main>
</template>
