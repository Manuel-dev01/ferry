import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useCashoutStore } from './stores/cashout'
import HomeView from './views/HomeView.vue'

/** Each cash-out step needs the ones before it; deep links into the middle go back to the start. */
const needs =
  (...fields: ('currency' | 'institution' | 'accountName' | 'amount')[]) =>
  () => {
    const draft = useCashoutStore()
    const ok = fields.every((f) => (f === 'amount' ? draft.amountInput !== '' : draft[f] !== null))
    return ok || { path: '/cashout' }
  }

const routes: RouteRecordRaw[] = [
  { path: '/', component: HomeView },
  { path: '/cashout', component: () => import('./views/cashout/CountryView.vue') },
  {
    path: '/cashout/bank',
    component: () => import('./views/cashout/InstitutionView.vue'),
    beforeEnter: needs('currency'),
  },
  {
    path: '/cashout/account',
    component: () => import('./views/cashout/AccountView.vue'),
    beforeEnter: needs('currency', 'institution'),
  },
  {
    path: '/cashout/confirm',
    component: () => import('./views/cashout/ConfirmNameView.vue'),
    beforeEnter: needs('currency', 'institution', 'accountName'),
  },
  {
    path: '/cashout/amount',
    component: () => import('./views/cashout/AmountView.vue'),
    beforeEnter: needs('currency', 'institution', 'accountName'),
  },
  {
    path: '/cashout/review',
    component: () => import('./views/cashout/ReviewView.vue'),
    beforeEnter: needs('currency', 'institution', 'accountName', 'amount'),
  },
  { path: '/orders/:id', component: () => import('./views/OrderView.vue'), props: true },
  { path: '/history', component: () => import('./views/HistoryView.vue') },
]

if (import.meta.env.VITE_SPIKES === 'true') {
  routes.push(
    { path: '/spike/s2', component: () => import('./views/spike/S2View.vue') },
    { path: '/spike/s3', component: () => import('./views/spike/S3View.vue') },
    { path: '/spike/s4', component: () => import('./views/spike/S4View.vue') },
  )
}

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
