import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useCashoutStore } from './stores/cashout'
import { useSessionStore } from './stores/session'
import RootView from './views/RootView.vue'

/** Each cash-out step needs the ones before it; deep links into the middle go back to the start. */
const needs =
  (...fields: ('currency' | 'institution' | 'accountName' | 'amount')[]) =>
  () => {
    const draft = useCashoutStore()
    const ok = fields.every((f) => (f === 'amount' ? draft.amountInput !== '' : draft[f] !== null))
    return ok || { path: '/cashout' }
  }

const app = { app: true }

const routes: RouteRecordRaw[] = [
  { path: '/', component: RootView },
  { path: '/landing', component: () => import('./views/LandingView.vue') },
  { path: '/cashout', component: () => import('./views/cashout/CountryView.vue'), meta: app },
  {
    path: '/cashout/fonbnk',
    component: () => import('./views/cashout/FonbnkView.vue'),
    // A link with ?tx= reopens a sent cash-out; otherwise a country must be chosen first.
    beforeEnter: (to) => (typeof to.query.tx === 'string' ? true : needs('currency')()),
    meta: app,
  },
  {
    path: '/cashout/bank',
    component: () => import('./views/cashout/InstitutionView.vue'),
    beforeEnter: needs('currency'),
    meta: app,
  },
  {
    path: '/cashout/account',
    component: () => import('./views/cashout/AccountView.vue'),
    beforeEnter: needs('currency', 'institution'),
    meta: app,
  },
  {
    path: '/cashout/confirm',
    component: () => import('./views/cashout/ConfirmNameView.vue'),
    beforeEnter: needs('currency', 'institution', 'accountName'),
    meta: app,
  },
  {
    path: '/cashout/amount',
    component: () => import('./views/cashout/AmountView.vue'),
    beforeEnter: needs('currency', 'institution', 'accountName'),
    meta: app,
  },
  {
    path: '/cashout/review',
    component: () => import('./views/cashout/ReviewView.vue'),
    beforeEnter: needs('currency', 'institution', 'accountName', 'amount'),
    meta: app,
  },
  { path: '/orders/:id', component: () => import('./views/OrderView.vue'), props: true, meta: app },
  {
    path: '/orders/:id/receipt',
    component: () => import('./views/ReceiptView.vue'),
    props: true,
    meta: app,
  },
  { path: '/history', component: () => import('./views/HistoryView.vue'), meta: app },
  { path: '/settings', component: () => import('./views/SettingsView.vue') },
  { path: '/privacy', component: () => import('./views/LegalView.vue'), props: { doc: 'privacy' } },
  { path: '/terms', component: () => import('./views/LegalView.vue'), props: { doc: 'terms' } },
]

if (import.meta.env.VITE_SPIKES === 'true') {
  routes.push(
    { path: '/spike/s2', component: () => import('./views/spike/S2View.vue') },
    { path: '/spike/s3', component: () => import('./views/spike/S3View.vue') },
    { path: '/spike/s4', component: () => import('./views/spike/S4View.vue') },
    { path: '/spike/s5', component: () => import('./views/spike/S5View.vue') },
  )
}

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to) => (to.hash ? { el: to.hash, behavior: 'smooth' } : { top: 0 }),
})

// Wallet screens only make sense inside Nimiq Pay; browsers get the landing page.
router.beforeEach((to) => {
  if (to.meta.app && useSessionStore().status === 'outside') return { path: '/' }
  return true
})
