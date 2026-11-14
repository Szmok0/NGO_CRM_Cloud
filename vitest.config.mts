import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/server/testSetup.global.ts'],
    // Pliki po kolei: test kreatora wymaga pustej tabeli użytkowników, a inne pliki zakładają konta testowe.
    fileParallelism: false,
    testTimeout: 30000
  }
})
