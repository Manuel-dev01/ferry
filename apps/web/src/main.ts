import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './styles/tokens.css'
import './styles/components.css'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { createAppI18n } from './i18n'
import { applyStoredTheme } from './lib/theme'
import { readHostContext } from './providers/host'
import { router } from './router'

applyStoredTheme()

createApp(App)
  .use(createPinia())
  .use(router)
  .use(createAppI18n(readHostContext().language))
  .mount('#app')
