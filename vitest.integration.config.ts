// vitest.integration.config.ts
import { defineConfig } from 'vitest/config'
import { config as loadDotenv } from 'dotenv'
import path from 'path'

// Nothing else loads `.env.test`, so without this `npm run test:integration`
// fails on an unset TEST_DATABASE_URL even when the file is sitting right
// there — every developer had to export the variable by hand first.
//
// Loaded here rather than in global-setup.ts because this module is evaluated
// before both the global setup (same process) and the forked test workers
// (which inherit this process's env), so one load covers both.
//
// `.env.test` only — never `.env`. Vite's loadEnv() would pull in `.env` too,
// which carries the *development* DATABASE_URL; the suite TRUNCATEs every
// table it can reach, so letting a dev connection string into this process is
// the one mistake the "must contain test" guard exists to catch. Better not to
// load it at all.
//
// override:false so a real exported variable still wins — CI injects
// TEST_DATABASE_URL directly and must not be overwritten by a stray file.
loadDotenv({ path: path.resolve(__dirname, '.env.test'), override: false, quiet: true })

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
