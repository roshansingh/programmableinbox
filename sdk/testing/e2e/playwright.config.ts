import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'otp.spec.ts',
  reporter: 'line',
  outputDir: './test-results',
})
