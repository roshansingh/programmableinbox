import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

const alias = { '@': path.resolve(__dirname, '.') }

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    css: false,
    exclude: ['node_modules', 'dist', '.worktrees/**/*', '.claude/**/*.test.*', '.claude/**/*.spec.*'],
    projects: [
      {
        // UI component tests — jsdom with MSW setup
        test: {
          name: 'ui',
          include: ['components/__tests__/**/*.test.*', 'app/**/__tests__/**/*.test.*'],
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'http://localhost:4000' } },
          globals: true,
          setupFiles: ['./test/setup.ts'],
          env: { NEXT_PUBLIC_API_MODE: 'local' },
        },
        resolve: { alias },
      },
      {
        // Pure Node tests — lib utilities, no DOM
        test: {
          name: 'node',
          include: ['lib/__tests__/**/*.test.*'],
          environment: 'node',
          globals: true,
          env: { NEXT_PUBLIC_API_MODE: 'local' },
        },
        resolve: { alias },
      },
    ],
  },
  resolve: { alias },
})
