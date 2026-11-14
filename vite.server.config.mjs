// Serwer: jeden plik dist/server/index.js; pakiety z node_modules zostają zewnętrzne.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  // Zbudowany serwer zawsze działa w trybie produkcyjnym (src/server/config.ts), bez polegania na zmiennych hostingu.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'index.js' } }
  }
})
