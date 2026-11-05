import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig, loadEnv } from 'vite'
import { requireProductionApiUrl } from './src/lib/buildApiUrl'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const productionApi = command === 'build' ? requireProductionApiUrl(env.VITE_API_URL) : null
  return {
    ...(productionApi
      ? { define: { 'import.meta.env.VITE_API_URL': JSON.stringify(productionApi) } }
      : {}),
    plugins: [vue(), UnoCSS()],
    server: {
      port: 5173,
      strictPort: true, // the phone URL and CORS expect this exact port
      host: true, // reachable from a phone on the same Wi-Fi
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  }
})
