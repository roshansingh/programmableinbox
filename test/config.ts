import { afterEach, beforeEach } from 'vitest'
import { resetConfigCache } from '@/lib/config'

/**
 * Installs `overrides` on top of the ambient test environment for the duration
 * of each test in the enclosing `describe`, and clears the config memo around
 * it.
 *
 * `lib/config` parses each domain once per process, so a suite that mutates
 * `process.env` without clearing the memo either reads a previous test's parse
 * or leaks its own value into the next file. Both failure modes are
 * order-dependent, which is exactly what the hand-rolled
 * `const originalEnv = { ...process.env }` snapshots in this repo used to be
 * exposed to. Calling this is what makes env-dependent tests order-independent.
 *
 * The valid baseline (`DATABASE_URL`, `JWT_SECRET`, …) comes from `configEnv`
 * in `vitest.config.ts`, so overrides here only need to name what the suite
 * actually varies. Pass `undefined` to unset a variable.
 *
 * @example
 * describe('async mode', () => {
 *   withConfigEnv({ ENABLE_ASYNC_WEBHOOK_PROCESSING: 'true' })
 *   // ...
 * })
 */
export function withConfigEnv(overrides: Record<string, string | undefined> = {}) {
  const original = { ...process.env }

  beforeEach(() => {
    process.env = { ...original }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetConfigCache()
  })

  afterEach(() => {
    process.env = { ...original }
    resetConfigCache()
  })
}

/**
 * Sets a variable and clears the memo, for a single test that needs a value
 * different from its suite's baseline.
 *
 * Use inside a `describe` that already calls {@link withConfigEnv}, which
 * restores the environment afterwards.
 */
export function setConfigEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  resetConfigCache()
}
