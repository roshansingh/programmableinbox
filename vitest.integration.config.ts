// vitest.integration.config.ts
import { defineConfig } from 'vitest/config'
import path from 'path'

const alias = { '@': path.resolve(__dirname, '.') }

export default defineConfig({
  test: {
    name: 'integration',
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['./test/integration/setup/setup.ts'],
    // Only global-setup here; it RETURNS the teardown (drops the DB). Do not add
    // global-teardown.ts to this array — it would run as a second setup.
    globalSetup: ['./test/integration/setup/global-setup.ts'],
    // One shared inbox_test DB with per-test TRUNCATE: files must run serially.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 60000,
    testTimeout: 30000,
    env: { NEXT_PUBLIC_API_MODE: 'local' },
  },
  resolve: { alias },
})
