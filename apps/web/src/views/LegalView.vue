<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppHeader from '../components/AppHeader.vue'
import { REPO_URL } from '../config'

defineProps<{ doc: 'privacy' | 'terms' }>()
const { t } = useI18n()
</script>

<template>
  <main class="fy-screen">
    <AppHeader
      back="/settings"
      :title="doc === 'privacy' ? t('legal.privacyTitle') : t('legal.termsTitle')"
    />
    <article class="fy-content legal" style="padding-top: 4px; gap: 14px">
      <template v-if="doc === 'privacy'">
        <h1 class="fy-display">What Ferry keeps, and why</h1>
        <p>
          Ferry is built to hold as little about you as possible. We never hold your money and never
          see your keys.
        </p>
        <h2 class="fy-title">On our servers</h2>
        <ul>
          <li>
            For a Fonbnk cash-out: the Polygon transaction, the sending and receiving addresses, the
            amount, country and payout method, and when you tapped “I’ve got my money”.
          </li>
          <li>
            For an M-Pesa Direct payout: the Lightning payment hash, the shilling amount and the
            M-Pesa receipt code. Not the phone number.
          </li>
          <li>For a gas top-up: your wallet address and the transaction.</li>
        </ul>
        <p>
          These records are what Proof of Ferry counts. They carry no names and no account numbers.
        </p>
        <h2 class="fy-title">What passes through</h2>
        <ul>
          <li>
            To get an M-Pesa Direct invoice, Ferry sends the phone number to Tando, which pays it.
            Ferry doesn’t store the number.
          </li>
          <li>Your Mavapay Money address goes to Mavapay to get its invoice.</li>
          <li>
            Fonbnk collects your email and account details in its own form. Ferry never sees them.
          </li>
        </ul>
        <h2 class="fy-title">On your phone</h2>
        <p>
          Your history (amounts, masked phone numbers, your Mavapay address) and the keys of any NIM
          swap stay on this device. Clearing the app’s data removes them.
        </p>
        <h2 class="fy-title">Who else is involved</h2>
        <p>
          Payouts are made by Fonbnk, by Tando over M-Pesa, and by Mavapay Money. NIM swaps go
          through LendaSwap. Wallet actions happen in Nimiq Pay. Each works under its own terms.
        </p>
        <h2 class="fy-title">Questions or deletion</h2>
        <p>
          Open an issue at
          <a :href="`${REPO_URL}/issues`" target="_blank" rel="noopener">our GitHub</a> and we’ll
          help, including deleting records tied to your wallet. Issues are public: don’t post phone
          or account numbers there.
        </p>
      </template>
      <template v-else>
        <h1 class="fy-display">The short version</h1>
        <ul>
          <li>
            Ferry is software that helps you pay a payout partner (Fonbnk, Tando for M-Pesa, Mavapay
            Money) from your own Nimiq Pay wallet, with USDT or NIM.
          </li>
          <li>
            You approve every payment yourself in Nimiq Pay. Ferry never holds or controls your
            money.
          </li>
          <li>Check the payout details you enter. Ferry can’t reverse a payout.</li>
          <li>
            Ferry adds no fee of its own. Partners’ rates and fees are shown before you approve.
          </li>
          <li>
            Each cash-out is up to 200 USDT. M-Pesa Direct goes up to KSh 49,000 at a time, and
            airtime has lower caps per country.
          </li>
          <li>
            Lightning payments are atomic: if the payout fails, so does the payment. Fonbnk orders
            are handled by Fonbnk under its own terms.
          </li>
          <li>Payout partners may review or decline a payout to meet their legal duties.</li>
          <li>Ferry is open source under the MIT licence and provided as is, without warranty.</li>
        </ul>
      </template>
    </article>
  </main>
</template>

<style scoped>
.legal p,
.legal li {
  margin: 0;
  font-size: 15.5px;
  line-height: 1.55;
  color: var(--fy-ink-2);
}
.legal ul {
  margin: 0;
  padding-left: 20px;
  list-style: disc;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
