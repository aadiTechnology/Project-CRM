import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      // Avoid random full reloads from unrelated folders / antivirus file touches.
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    fileParallelism: false,
    env: {
      VITE_API_BASE_URL: 'http://127.0.0.1:8000',
      VITE_DEFAULT_LANGUAGE: 'en',
    },
  },
})
