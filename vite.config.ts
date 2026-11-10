import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/domain/testing/setup.ts'],
    // Property tests try hundreds of random cases each, and the ones of the data layer run against
    // an in-memory IndexedDB: with every file running in parallel, five seconds is not enough.
    testTimeout: 60_000,
  },
})
