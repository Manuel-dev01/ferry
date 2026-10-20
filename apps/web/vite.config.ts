import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), UnoCSS()],
  server: {
    port: 5173,
    host: true, // reachable from a phone on the same Wi-Fi
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
