// vitest.integration.config.ts
import { defineConfig } from 'vitest/config'
import path from 'path'

// See vitest.config.ts for why `server-only` is aliased to its empty module.
const alias = {
  '@': path.resolve(__dirname, '.'),
  'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
}

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
    // fileParallelism:false already forces a single worker in Vitest 4; the old
    // poolOptions.forks.singleFork is redundant and triggers a deprecation warning.
    fileParallelism: false,
    pool: 'forks',
    hookTimeout: 60000,
    testTimeout: 30000,
    env: { NEXT_PUBLIC_API_MODE: 'local' },
  },
  resolve: { alias },
})
