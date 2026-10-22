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
          <li>Order details: amounts, rate, status, time, and the Polygon transaction.</li>
          <li>A masked recipient (like ••••6789) and the bank or wallet code.</li>
          <li>Your wallet address, so refunds go back to you.</li>
          <li>A one-way hash of your device ID, only to apply daily limits and reward caps.</li>
        </ul>
        <p>
          Full account numbers and names are sent to our payout partner when you create an order, so
          they can pay the right person. Ferry doesn't store them.
        </p>
        <h2 class="fy-title">On your phone</h2>
        <p>
          Your history, including the names of people you paid, stays on this device. Clearing the
          app's data removes it.
        </p>
        <h2 class="fy-title">Who else is involved</h2>
        <p>
          Payouts are made by licensed payout partners in each country through Paycrest. Wallet
          actions happen in Nimiq Pay.
        </p>
        <h2 class="fy-title">Questions or deletion</h2>
        <p>
          Open an issue at
          <a :href="`${REPO_URL}/issues`" target="_blank" rel="noopener">our GitHub</a> and we'll
          help, including deleting order records tied to your wallet.
        </p>
      </template>
      <template v-else>
        <h1 class="fy-display">The short version</h1>
        <ul>
          <li>
            Ferry is software that helps you send USDT from your own Nimiq Pay wallet to a licensed
            payout partner, who pays the bank or mobile-money account you choose.
          </li>
          <li>
            You approve every transfer yourself in Nimiq Pay. Ferry never holds or controls your
            money.
          </li>
          <li>
            Check the verified name before you sign. Payouts to the account shown can't be reversed
            by Ferry.
          </li>
          <li>
            Each payout is $1 to $200, up to $500 a day. The Ferry fee is shown before you sign.
          </li>
          <li>If a payout can't complete, the payout partner returns your USDT to your wallet.</li>
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
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
