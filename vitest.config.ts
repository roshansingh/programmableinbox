import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:4000',
      },
    },
    globals: true,
    css: false,
    setupFiles: ['./test/setup.ts'],
    env: {
      NEXT_PUBLIC_API_MODE: 'local',
    },
    exclude: ['node_modules', 'dist', '.worktrees/**/*.test.*', '.claude/**/*.test.*'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
