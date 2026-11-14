// Klient (SPA). Konfiguracja jako .mjs (Hostinger nie wczytywał konfiguracji .ts w iV_CRM).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    outDir: resolve('dist/client'),
    emptyOutDir: true,
    // Bez wstawek inline (ścisła CSP, ZADANIE_01 krok 3)
    assetsInlineLimit: 0
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' }
  }
})
