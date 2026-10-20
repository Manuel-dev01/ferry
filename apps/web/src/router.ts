import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from './views/HomeView.vue'

const routes: RouteRecordRaw[] = [{ path: '/', component: HomeView }]

if (import.meta.env.VITE_SPIKES === 'true') {
  routes.push(
    { path: '/spike/s2', component: () => import('./views/spike/S2View.vue') },
    { path: '/spike/s3', component: () => import('./views/spike/S3View.vue') },
    { path: '/spike/s4', component: () => import('./views/spike/S4View.vue') },
  )
}

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })

export const router = createRouter({ history: createWebHistory(), routes })
