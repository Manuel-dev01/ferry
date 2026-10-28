<script setup lang="ts">
import { FONBNK_COUNTRIES, FONBNK_COUNTRY_CODES, type StatsResponse } from '@ferry/shared'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { renderSVG } from 'uqr'
import FerryLogo from '../components/FerryLogo.vue'
import NimiqMark from '../components/NimiqMark.vue'
import { REPO_URL } from '../config'
import { useLandingMotion } from '../composables/useLandingMotion'
import { api } from '../lib/api'
import { FLAGS } from '../lib/corridors'
import { channelLabel, flagOf } from '../lib/fonbnk'
import {
  durationDisplay,
  polygonscanTx,
  roughDurationDisplay,
  usdHeadline,
  usdtDisplay,
} from '../lib/format'
import { openInNimiqPayUrl } from '../providers/host'

const { t, te } = useI18n()
useLandingMotion()

const openUrl = openInNimiqPayUrl()
// Our own SVG from a URL we control, so v-html is safe here.
const qrSvg = renderSVG(openUrl, { border: 1, whiteColor: '#FFFFFF', blackColor: '#0B0E3A' })

const stats = ref<StatsResponse | null>(null)
onMounted(async () => {
  try {
    stats.value = await api<StatsResponse>('/v1/stats')
  } catch {
    stats.value = null
  }
})
const hasStats = computed(() => !!stats.value && stats.value.cashouts > 0)
const statTiles = computed(() => {
  const s = stats.value
  const dash = '—'
  return [
    {
      v: hasStats.value ? s!.cashouts.toLocaleString('en') : dash,
      k: t('landing.proof.settled'),
      bg: 'cream',
    },
    {
      v: hasStats.value ? s!.uniqueWallets.toLocaleString('en') : dash,
      k: t('landing.proof.wallets'),
      bg: 'cream',
    },
    {
      v: s?.medianSeconds != null ? roughDurationDisplay(s.medianSeconds * 1000) : dash,
      k: t('landing.proof.median'),
      bg: 'mint',
    },
    {
      v: hasStats.value ? s!.confirmedPaid.toLocaleString('en') : dash,
      k: t('landing.proof.confirmed'),
      bg: 'mint',
    },
    {
      v: hasStats.value ? usdHeadline(BigInt(s!.volumeUnits)) : dash,
      k: t('landing.proof.volume'),
      bg: 'tangerine',
    },
    {
      v: hasStats.value ? String(s!.countries) : dash,
      k: t('landing.proof.countries'),
      bg: 'tangerine',
    },
  ]
})

const faqs = [1, 2, 3, 4, 5, 6].map((n) => ({
  q: t(`landing.faq.q${n}`),
  a: t(`landing.faq.a${n}`),
}))
const MAIN_COUNTRIES = ['NG', 'KE', 'UG', 'TZ']
const moreCountries = FONBNK_COUNTRY_CODES.filter((c) => !MAIN_COUNTRIES.includes(c)).map(
  (code) => ({ code, name: FONBNK_COUNTRIES[code].name }),
)
const countries = [
  {
    flag: FLAGS.NGN,
    name: 'Nigeria',
    cur: t('landing.countries.ngCur'),
    body: t('landing.countries.ng'),
    cls: 'c-cobalt',
    tilt: -1.2,
  },
  {
    flag: FLAGS.KES,
    name: 'Kenya',
    cur: t('landing.countries.keCur'),
    body: t('landing.countries.ke'),
    cls: 'c-mint',
    tilt: 1,
  },
  {
    flag: FLAGS.UGX,
    name: 'Uganda',
    cur: t('landing.countries.ugCur'),
    body: t('landing.countries.ug'),
    cls: 'c-tangerine',
    tilt: -0.8,
  },
  {
    flag: FLAGS.TZS,
    name: 'Tanzania',
    cur: t('landing.countries.tzCur'),
    body: t('landing.countries.tz'),
    cls: 'c-ink',
    tilt: 1.4,
  },
]
</script>

<template>
  <div class="landing">
    <!-- 01 Hero -->
    <section class="hero">
      <nav class="hero__nav">
        <a href="#" class="fy-logo" style="color: inherit"><FerryLogo on-brand /></a>
        <div class="hero__links">
          <a href="#how">{{ t('landing.nav.how') }}</a>
          <a href="#countries">{{ t('landing.nav.countries') }}</a>
          <a href="#safe">{{ t('landing.nav.safe') }}</a>
          <a href="#proof">{{ t('landing.nav.proof') }}</a>
          <a href="#faq">{{ t('landing.nav.faq') }}</a>
        </div>
        <a href="#test" class="hero__test">{{ t('landing.nav.testDrive') }}</a>
      </nav>

      <h1 class="hero__title">{{ t('landing.hero.title') }}</h1>

      <div class="hero__stack" aria-hidden="true">
        <div class="hero__persp">
          <div class="hero__float">
            <div class="hero__rot">
              <div class="deal-card c-cream" style="transform: translate3d(-70px, 70px, 0)">
                <div class="flex items-center justify-between">
                  <span class="fy-eyebrow">{{ t('landing.cards.account') }}</span>
                  <span class="lmono">OP</span>
                </div>
                <span class="deal-card__num">812 345 6789</span>
                <span class="deal-card__meta">OPay · Nigeria</span>
              </div>
              <div class="deal-card c-tangerine land-1" style="transform: translate3d(0, 0, 70px)">
                <span class="fy-eyebrow">{{ t('landing.cards.verified') }}</span>
                <span class="deal-card__name">ADA OBI</span>
                <span class="deal-card__meta flex items-center justify-between gap-2">
                  <span>OPay · ••••6789</span>
                  <span class="deal-card__pill">{{ t('landing.cards.yes') }}</span>
                </span>
              </div>
              <div
                class="deal-card c-mint land-2"
                style="transform: translate3d(70px, -70px, 140px)"
              >
                <span class="fy-eyebrow">{{ t('landing.cards.paid') }}</span>
                <span class="deal-card__amt">₦27,061.00</span>
                <span class="deal-card__meta">{{ t('landing.cards.sent') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="hero__foot">
        <p class="hero__lede">{{ t('landing.hero.lede') }}</p>
        <div class="flex flex-wrap items-center gap-4">
          <a :href="openUrl" class="cta cta--cream">
            <span class="cta__mark"><NimiqMark :size="20" /></span>{{ t('common.openInNimiqPay') }}
          </a>
          <div class="flex items-center gap-3 hero__qr-wrap">
            <!-- eslint-disable-next-line vue/no-v-html -- QR SVG generated locally by uqr from our own URL -->
            <div class="hero__qr" v-html="qrSvg" />
            <span class="hero__scan">{{ t('landing.hero.scan') }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 02 How it works (scroll scene) -->
    <section id="how" class="how" data-scene>
      <div class="how__sticky">
        <div class="how__copy">
          <span class="fy-eyebrow" style="color: #4b5080">{{ t('landing.how.label') }}</span>
          <div class="grid">
            <div class="how__step" style="opacity: clamp(0, calc((0.33 - var(--p, 0)) * 30), 1)">
              <span class="how__n">01</span>
              <h2 class="how__h">{{ t('landing.how.s1Title') }}</h2>
              <p class="how__p">{{ t('landing.how.s1Body') }}</p>
            </div>
            <div
              class="how__step"
              style="
                opacity: clamp(
                  0,
                  min(calc((var(--p, 0) - 0.33) * 30), calc((0.66 - var(--p, 0)) * 30)),
                  1
                );
              "
            >
              <span class="how__n">02</span>
              <h2 class="how__h">{{ t('landing.how.s2Title') }}</h2>
              <p class="how__p">{{ t('landing.how.s2Body') }}</p>
            </div>
            <div class="how__step" style="opacity: clamp(0, calc((var(--p, 0) - 0.66) * 30), 1)">
              <span class="how__n">03</span>
              <h2 class="how__h">{{ t('landing.how.s3Title') }}</h2>
              <p class="how__p">{{ t('landing.how.s3Body') }}</p>
            </div>
          </div>
          <div class="how__bars" aria-hidden="true">
            <span />
            <span style="opacity: clamp(0.18, calc((var(--p, 0) - 0.33) * 30), 1)" />
            <span style="opacity: clamp(0.18, calc((var(--p, 0) - 0.66) * 30), 1)" />
          </div>
        </div>
        <div class="how__stage" aria-hidden="true">
          <div class="how__persp">
            <div class="how__rot">
              <div
                class="how-card c-white"
                style="
                  --e: clamp(0, calc((var(--p, 0) - 0.02) * 5), 1);
                  transform: translate3d(
                      calc(var(--e) * min(-90px, -9vw)),
                      calc((1 - var(--e)) * 100vh - var(--e) * 64px),
                      0
                    )
                    rotate(calc(-7deg + (1 - var(--e)) * -30deg));
                "
              >
                <div class="flex items-center justify-between">
                  <span class="fy-eyebrow">{{ t('landing.how.cardAccount') }}</span
                  ><span class="lmono">OP</span>
                </div>
                <span class="deal-card__num" style="font-size: 28px">812 345 6789</span>
                <span class="deal-card__meta">{{ t('landing.how.cardDigits') }}</span>
              </div>
              <div
                class="how-card c-tangerine"
                style="
                  --e: clamp(0, calc((var(--p, 0) - 0.34) * 5), 1);
                  transform: translate3d(0, calc((1 - var(--e)) * 100vh), 40px)
                    rotate(calc(2deg + (1 - var(--e)) * 30deg));
                "
              >
                <span class="fy-eyebrow">{{ t('landing.how.cardWho') }}</span>
                <span class="deal-card__name" style="font-size: 38px">ADA OBI</span>
                <span class="deal-card__meta flex items-center justify-between gap-2">
                  <span>OPay ••••6789</span
                  ><span class="deal-card__pill">{{ t('landing.how.cardYes') }}</span>
                </span>
              </div>
              <div
                class="how-card c-mint"
                style="
                  --e: clamp(0, calc((var(--p, 0) - 0.67) * 5), 1);
                  transform: translate3d(
                      calc(var(--e) * min(90px, 9vw)),
                      calc((1 - var(--e)) * 100vh + var(--e) * 64px),
                      80px
                    )
                    rotate(calc(-1.5deg + (1 - var(--e)) * 34deg));
                "
              >
                <span class="fy-eyebrow">{{ t('landing.how.cardPaid') }}</span>
                <span class="deal-card__amt" style="font-size: 42px">₦27,061.00</span>
                <span class="deal-card__meta">{{ t('landing.how.cardPaidSub') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 03 Countries -->
    <section id="countries" class="band band--cream">
      <div class="band__head">
        <h2 class="band__h" style="max-width: 760px">{{ t('landing.countries.title') }}</h2>
        <p class="band__p">{{ t('landing.countries.lede') }}</p>
      </div>
      <div class="countries">
        <div
          v-for="c in countries"
          :key="c.name"
          class="country"
          :class="c.cls"
          :style="{ '--tilt': `${c.tilt}deg` }"
        >
          <span style="font-size: 40px; line-height: 1">{{ c.flag }}</span>
          <span class="country__name">{{ c.name }}</span>
          <span style="font-size: 16px; font-weight: 600">{{ c.cur }}</span>
          <span class="country__body">{{ c.body }}</span>
        </div>
      </div>
      <div class="more-countries">
        <span class="more-countries__label">{{ t('landing.countries.more') }}</span>
        <span v-for="c in moreCountries" :key="c.code" class="more-countries__chip"
          >{{ flagOf(c.code) }} {{ c.name }}</span
        >
      </div>
    </section>

    <!-- 04 Why it's safe -->
    <section id="safe" class="band band--night">
      <h2 class="band__h" style="max-width: 820px">{{ t('landing.safe.title') }}</h2>
      <div class="safe">
        <div class="safe__cell">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8FE3C2"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7l13-3v3M16 13.5h2" />
          </svg>
          <span class="safe__h">{{ t('landing.safe.custodyTitle') }}</span>
          <span class="safe__p">{{ t('landing.safe.custodyBody') }}</span>
        </div>
        <div class="safe__cell">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FF8A3D"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span class="safe__h">{{ t('landing.safe.namesTitle') }}</span>
          <span class="safe__p">{{ t('landing.safe.namesBody') }}</span>
        </div>
        <div class="safe__cell">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9BA4FF"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
          </svg>
          <span class="safe__h">{{ t('landing.safe.partnersTitle') }}</span>
          <span class="safe__p">{{ t('landing.safe.partnersBody') }}</span>
        </div>
        <div class="safe__cell">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FFF4E2"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
          </svg>
          <span class="safe__h">{{ t('landing.safe.openTitle') }}</span>
          <span class="safe__p">{{ t('landing.safe.openBody') }}</span>
        </div>
      </div>
    </section>

    <!-- 05 Proof of Ferry -->
    <section id="proof" class="band band--cobalt">
      <div class="band__head">
        <div class="flex flex-col gap-3.5">
          <span class="live"
            ><span class="live__dot" />{{
              hasStats ? t('landing.proof.live') : t('landing.proof.pending')
            }}</span
          >
          <h2 class="band__h">{{ t('landing.proof.title') }}</h2>
        </div>
        <p class="band__p" style="color: #e4e8ff">{{ t('landing.proof.lede') }}</p>
      </div>
      <div class="stats">
        <div v-for="s in statTiles" :key="s.k" class="stat" :class="`c-${s.bg}`">
          <span class="stat__v">{{ s.v }}</span>
          <span style="font-size: 15px; font-weight: 600">{{ s.k }}</span>
        </div>
      </div>
      <div class="payouts">
        <div class="payouts__head">
          <span style="font: 700 17px var(--fy-font-body)">{{ t('landing.proof.latest') }}</span>
        </div>
        <template v-if="stats?.latest.length">
          <a
            v-for="p in stats.latest.slice(0, 6)"
            :key="p.txHash"
            class="payouts__row"
            :href="polygonscanTx(p.txHash)"
            target="_blank"
            rel="noopener"
          >
            <span style="font-size: 20px">{{ flagOf(p.country) }}</span>
            <span style="font-weight: 700">{{ usdtDisplay(BigInt(p.amountUnits)) }} USDT</span>
            <span class="payouts__to">{{ channelLabel(t, te, p.country, p.channel) }}</span>
            <span class="payouts__chip">{{
              p.seconds !== null
                ? t('landing.proof.paidIn', { t: durationDisplay(p.seconds * 1000) })
                : t('landing.proof.sent')
            }}</span>
          </a>
        </template>
        <p v-else class="payouts__empty">{{ t('landing.proof.empty') }}</p>
        <RouterLink to="/proof" class="payouts__more">{{ t('landing.proof.more') }} →</RouterLink>
      </div>
    </section>

    <!-- 06 Test drive -->
    <section id="test" class="band band--cream2">
      <div class="test">
        <div class="test__deco" aria-hidden="true" />
        <div class="test__copy">
          <span class="fy-eyebrow" style="font-size: 13px">{{ t('landing.test.label') }}</span>
          <h2 class="band__h">{{ t('landing.test.title') }}</h2>
          <p style="margin: 0; max-width: 520px; font-size: 18px; line-height: 1.5">
            {{ t('landing.test.body') }}
          </p>
          <a :href="openUrl" class="cta cta--ink">
            <span class="cta__mark"><NimiqMark :size="20" /></span>{{ t('landing.test.cta') }}
          </a>
        </div>
        <div class="test__qr">
          <!-- eslint-disable-next-line vue/no-v-html -- QR SVG generated locally by uqr from our own URL -->
          <div class="test__qr-img" v-html="qrSvg" />
          <span style="font-size: 14px; font-weight: 600; text-align: center">{{
            t('landing.test.scan')
          }}</span>
        </div>
      </div>
    </section>

    <!-- 07 FAQ -->
    <section id="faq" class="band band--cream2 faq" style="padding-top: 0">
      <h2 class="band__h faq__h">{{ t('landing.faq.title') }}</h2>
      <div class="faq__list">
        <details v-for="f in faqs" :key="f.q" class="faq__item">
          <summary>{{ f.q }}<span class="faq__plus" aria-hidden="true">+</span></summary>
          <p>{{ f.a }}</p>
        </details>
      </div>
    </section>

    <!-- 08 Footer -->
    <footer class="foot">
      <div class="foot__top">
        <div class="flex flex-col gap-3">
          <FerryLogo on-brand />
          <span style="font-size: 15px; color: #b9bde8">{{ t('landing.footer.tagline') }}</span>
        </div>
        <div class="foot__links">
          <a :href="REPO_URL" target="_blank" rel="noopener">{{ t('landing.footer.github') }}</a>
          <RouterLink to="/privacy">{{ t('settings.privacy') }}</RouterLink>
          <RouterLink to="/terms">{{ t('settings.terms') }}</RouterLink>
          <a href="#proof">{{ t('landing.proof.title') }}</a>
        </div>
      </div>
      <div class="foot__bottom">
        <span>{{ t('landing.footer.built') }}</span
        ><span>{{ t('landing.footer.license') }}</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  overflow-x: clip;
  background: #2337e8;
  color: #fff;
  --gx: clamp(20px, 4vw, 56px);
}
.landing a {
  color: inherit;
}
.c-cream {
  background: #fff4e2;
  color: #0b0e3a;
}
.c-white {
  background: #fff;
  color: #0b0e3a;
  box-shadow:
    0 0 0 1px #e7ddcc,
    0 30px 50px -24px rgba(11, 14, 58, 0.45);
}
.c-tangerine {
  background: #ff8a3d;
  color: #0b0e3a;
}
.c-mint {
  background: #8fe3c2;
  color: #0b0e3a;
}
.c-cobalt {
  background: #2337e8;
  color: #fff;
}
.c-ink {
  background: #0b0e3a;
  color: #fff4e2;
}
.lmono {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: #0b0e3a;
  color: #fff4e2;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 700 13px var(--fy-font-body);
}

/* Hero */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #2337e8;
}
.hero__nav {
  height: 84px;
  flex: none;
  padding: 0 var(--gx);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  position: relative;
  z-index: 5;
}
.hero__links {
  display: flex;
  gap: 28px;
  font-size: 15px;
  font-weight: 500;
  color: #dce1ff;
}
.hero__links a {
  text-decoration: none;
  white-space: nowrap;
}
.hero__test {
  height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.55);
  display: flex;
  align-items: center;
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  white-space: nowrap;
}
.hero__title {
  position: relative;
  z-index: 1;
  margin: 0;
  padding: 4px var(--gx) 0;
  font: 800 clamp(52px, 8.4vw, 132px) / 0.88 var(--fy-font-display);
  letter-spacing: -0.05em;
  max-width: min(68%, calc(100% - 400px));
  box-sizing: border-box;
}
.hero__stack {
  position: absolute;
  z-index: 2;
  left: 80%;
  top: 62%;
  width: 0;
  height: 0;
  pointer-events: none;
  scale: 0.8;
}
.hero__persp {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  perspective: 1200px;
}
.hero__float {
  animation: l-float 6s ease-in-out infinite;
}
.hero__rot {
  position: relative;
  transform-style: preserve-3d;
  transform: rotateX(calc(28deg + var(--my, 0) * -14deg))
    rotateY(calc(-18deg + var(--mx, 0) * 26deg)) rotateZ(-8deg);
}
.deal-card {
  position: absolute;
  left: calc(min(380px, 78vw) / -2);
  top: -120px;
  width: min(380px, 78vw);
  height: 240px;
  border-radius: 26px;
  padding: 22px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 30px 50px -20px rgba(11, 14, 58, 0.6);
}
.deal-card__num {
  font: 700 min(30px, 7vw) var(--fy-font-body);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.deal-card__name {
  font: 800 min(40px, 9vw)/1 var(--fy-font-display);
  letter-spacing: -0.03em;
  white-space: nowrap;
}
.deal-card__amt {
  font: 800 min(46px, 10vw)/1 var(--fy-font-display);
  letter-spacing: -0.045em;
  white-space: nowrap;
}
.deal-card__meta {
  font-size: 14px;
  font-weight: 600;
}
.deal-card__pill {
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: #0b0e3a;
  color: #ff8a3d;
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.land-1 {
  animation: l-land 0.7s cubic-bezier(0.34, 1.4, 0.5, 1) 0.15s both;
}
.land-2 {
  animation: l-land 0.7s cubic-bezier(0.34, 1.4, 0.5, 1) 0.45s both;
}
.hero__foot {
  position: relative;
  z-index: 3;
  margin-top: auto;
  padding: 40px var(--gx) 48px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-width: 560px;
  box-sizing: border-box;
}
.hero__lede {
  margin: 0;
  max-width: 440px;
  font-size: clamp(17px, 1.5vw, 20px);
  line-height: 1.45;
  color: #e4e8ff;
  text-wrap: pretty;
}
.hero__qr {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  padding: 4px;
  box-sizing: border-box;
}
.hero__qr :deep(svg),
.test__qr-img :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.hero__scan {
  font-size: 13.5px;
  line-height: 1.4;
  color: #dce1ff;
  max-width: 150px;
}
.cta {
  height: 60px;
  padding: 0 26px 0 12px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-weight: 700;
  font-size: 17px;
  text-decoration: none;
  white-space: nowrap;
  transition: transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cta:active {
  transform: scale(0.97);
}
.cta--cream {
  background: #fff4e2;
  color: #0b0e3a !important;
}
.cta--ink {
  align-self: flex-start;
  background: #0b0e3a;
  color: #fff4e2 !important;
}
.cta__mark {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* How it works */
.how {
  position: relative;
  height: 320vh;
  background: #fff4e2;
  color: #0b0e3a;
}
.how__sticky {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  align-items: center;
  gap: 24px;
  padding: 0 var(--gx);
  box-sizing: border-box;
}
.how__copy {
  flex: 1 1 380px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.how__step {
  grid-area: 1 / 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.how__n {
  font: 800 18px var(--fy-font-display);
  color: #2337e8;
}
.how__h {
  margin: 0;
  font: 800 clamp(38px, 5vw, 72px) / 0.95 var(--fy-font-display);
  letter-spacing: -0.045em;
}
.how__p {
  margin: 0;
  font-size: 18px;
  line-height: 1.45;
  color: #4b5080;
  max-width: 440px;
}
.how__bars {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  max-width: 360px;
}
.how__bars span {
  height: 4px;
  border-radius: 2px;
  background: #2337e8;
}
.how__stage {
  flex: 1 1 420px;
  min-width: 0;
  height: clamp(300px, 46vh, 460px);
  position: relative;
}
.how__persp {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  perspective: 1400px;
}
.how__rot {
  position: relative;
  transform-style: preserve-3d;
  transform: rotateX(calc(10deg + var(--my, 0) * -5deg)) rotateY(calc(var(--mx, 0) * 9deg));
}
.how-card {
  position: absolute;
  left: calc(min(320px, 76vw) / -2);
  top: -100px;
  width: min(320px, 76vw);
  height: 200px;
  border-radius: 24px;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 30px 50px -24px rgba(11, 14, 58, 0.45);
  opacity: clamp(0, calc(var(--e) * 3), 1);
}

/* Bands */
.band {
  padding: clamp(64px, 10vw, 120px) var(--gx);
  display: flex;
  flex-direction: column;
  gap: 40px;
}
.band--cream {
  background: #fbf6ee;
  color: #0b0e3a;
}
.band--cream2 {
  background: #fbf6ee;
  color: #0b0e3a;
}
.band--night {
  background: #0a0c2b;
  color: #fff4e2;
}
.band--cobalt {
  background: #2337e8;
  color: #fff;
}
.band__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
}
.band__h {
  margin: 0;
  font: 800 clamp(40px, 6vw, 88px) / 0.92 var(--fy-font-display);
  letter-spacing: -0.05em;
}
.band__p {
  margin: 0;
  max-width: 380px;
  font-size: 17px;
  line-height: 1.5;
  color: #4b5080;
}

.countries {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
  gap: 16px;
}
.country {
  min-height: 280px;
  border-radius: 28px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transform: rotate(var(--tilt));
  transition: transform 0.32s cubic-bezier(0.34, 1.4, 0.5, 1);
}
.country:hover {
  transform: rotate(0deg) translateY(-6px);
}
.country__name {
  font: 800 34px/1 var(--fy-font-display);
  letter-spacing: -0.04em;
  margin-top: auto;
}
.country__body {
  font-size: 15px;
  line-height: 1.45;
  opacity: 0.9;
}

.safe {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 1px;
  background: #2c3275;
  border-radius: 28px;
  overflow: hidden;
}
.safe__cell {
  background: #141849;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 220px;
}
.safe__h {
  font: 800 24px var(--fy-font-display);
  letter-spacing: -0.03em;
  margin-top: auto;
}
.safe__p {
  font-size: 15.5px;
  line-height: 1.5;
  color: #b9bde8;
}

.live {
  align-self: flex-start;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.live__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8fe3c2;
  animation: l-blink 1.6s ease-in-out infinite;
}
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (min-width: 900px) {
  .stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.stat {
  border-radius: 24px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stat__v {
  font: 800 clamp(40px, 4.4vw, 56px) / 1 var(--fy-font-display);
  letter-spacing: -0.045em;
}
.payouts {
  border-radius: 24px;
  background: #1e30d0;
  overflow: hidden;
}
.payouts__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.payouts__row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1.4fr) minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-height: 56px;
  padding: 0 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 15px;
}
.payouts__to {
  color: #dce1ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.payouts__chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 8px;
  background: #8fe3c2;
  color: #0b0e3a;
  font-size: 12.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.payouts__more {
  display: inline-flex;
  align-items: center;
  min-height: 52px;
  padding: 0 22px;
  font-weight: 700;
  color: inherit;
}
.payouts__empty {
  margin: 0;
  padding: 22px;
  font-size: 15.5px;
  line-height: 1.5;
  color: #dce1ff;
}

.test {
  position: relative;
  border-radius: 36px;
  background: #ff8a3d;
  padding: clamp(28px, 5vw, 64px);
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  align-items: center;
  overflow: hidden;
}
.test__deco {
  position: absolute;
  right: -60px;
  bottom: -80px;
  width: 340px;
  height: 220px;
  border-radius: 28px;
  background: #fff4e2;
  transform: rotate(-12deg);
  opacity: 0.55;
}
.test__copy {
  position: relative;
  flex: 1 1 420px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.test__qr {
  position: relative;
  flex: 0 1 260px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  padding: 20px;
  border-radius: 24px;
  background: #fff;
  transform: rotate(2deg);
  box-shadow: 0 30px 50px -24px rgba(11, 14, 58, 0.45);
}
.test__qr-img {
  width: 180px;
  height: 180px;
}

.faq {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 32px 64px;
}
.faq__h {
  flex: 1 1 300px;
  font-size: clamp(40px, 5vw, 72px);
}
.faq__list {
  flex: 2 1 520px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.faq__item {
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 0 0 1px #e7ddcc;
}
.faq__item summary {
  list-style: none;
  cursor: pointer;
  min-height: 64px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font: 700 18px var(--fy-font-body);
}
.faq__item summary::-webkit-details-marker {
  display: none;
}
.faq__item p {
  margin: 0;
  padding: 0 20px 20px;
  font-size: 16px;
  line-height: 1.55;
  color: #4b5080;
  max-width: 640px;
}
.faq__plus {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 18px;
  background: #f4ecdf;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 500;
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.faq__item[open] .faq__plus {
  transform: rotate(45deg);
}

.foot {
  background: #0b0e3a;
  color: #fff4e2;
  padding: 48px var(--gx) 40px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}
.foot__top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}
.foot__links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 28px;
  font-size: 15px;
  font-weight: 600;
}
.foot__links a {
  text-decoration: none;
  min-height: 44px;
  display: flex;
  align-items: center;
}
.foot__bottom {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid #2c3275;
  font-size: 13.5px;
  color: #b9bde8;
}

@keyframes l-land {
  from {
    translate: 0 -90px;
    opacity: 0;
  }
  to {
    translate: 0 0;
    opacity: 1;
  }
}
@keyframes l-float {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -12px;
  }
}
@keyframes l-blink {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 1000px) {
  .hero__links {
    display: none;
  }
}
@media (max-width: 1080px) {
  .hero__title {
    max-width: none;
  }
  .hero__stack {
    position: relative;
    left: 50%;
    top: auto;
    height: 360px;
    margin-top: 200px;
    scale: 0.62;
  }
}
@media (max-width: 640px) {
  .hero__qr-wrap {
    display: none;
  }
  .test__qr {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hero__float,
  .land-1,
  .land-2,
  .live__dot {
    animation: none;
  }
}
.more-countries {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
}
.more-countries__label {
  font-weight: 700;
  margin-right: 4px;
}
.more-countries__chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--fy-surface);
  box-shadow: inset 0 0 0 1px var(--fy-line);
  font-size: 15px;
  font-weight: 600;
}
</style>
