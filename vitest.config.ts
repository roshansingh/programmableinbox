import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// `server-only` resolves to a module that throws unless the bundler sets the
// `react-server` export condition, which Next does for server builds and Vitest
// does not. Point it at the package's own empty module so server modules that
// declare the marker stay importable from tests. Aliasing only this specifier
// is narrower than enabling `react-server` globally, which would change how
// other packages resolve.
const alias = {
  '@': path.resolve(__dirname, '.'),
  'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
}

/**
 * A configuration baseline every suite starts from.
 *
 * `lib/config` validates on first read and refuses to hand back an unvalidated
 * value, so any test that transitively touches a validated module needs a
 * parseable environment. Providing it here rather than in eight separate test
 * files keeps the requirement in one place; suites that exercise a specific
 * value still override it and call `resetConfigCache()` (see test/config.ts).
 */
const configEnv = {
  NEXT_PUBLIC_API_MODE: 'local',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?options=-c%20timezone%3DUTC',
  JWT_SECRET: 'test-jwt-secret-at-least-16-chars',
  WEBHOOK_SECRET: 'test-webhook-secret',
  AUTH_RESEND_API_KEY: 're_test_placeholder',
  AUTH_EMAIL_FROM: 'test@example.com',
  AUTH_EMAIL_FROM_NAME: 'Test',
  // REDIS_URL has no production default on purpose (see lib/config/schema.ts).
  // Supplying one here is a test fixture, not a fallback: suites that mock
  // ioredis still need a configured URL to build connection options from, and
  // the tests that exercise the unset case delete it explicitly.
  REDIS_URL: 'redis://localhost:6379',
  // Off by default, unlike production. Every suite that exercises the limiter
  // turns it on with `withConfigEnv` *and* injects a `FakeRedis`; leaving the
  // production default in place only affected the suites that do neither —
  // a login or register route test would reach for the URL above and find
  // whatever Redis the developer happens to be running. That is a test reading
  // and writing shared mutable state outside the repository: counters survive
  // between runs, so `npm test` three times in an hour trips the 5-per-hour
  // register limit and fails tests that have nothing to do with rate limiting,
  // while the same suite passes on CI where nothing is listening on 6379.
  AUTH_RATE_LIMIT_ENABLED: 'false',
}

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    css: false,
    exclude: ['node_modules', 'dist', '.worktrees/**/*', '.claude/**/*.test.*', '.claude/**/*.spec.*', 'test/integration/**'],
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
          env: configEnv,
        },
        resolve: { alias },
      },
      {
        // Pure Node tests — lib utilities, no DOM
        test: {
          name: 'node',
          // `ee/` carries the commercial plan implementations (issue #117 §8).
          // Its tests run in the same project as `lib/` on purpose: the OSS
          // build is verified by *deleting* ee/ and re-running, so these must
          // be ordinary tests that simply disappear with the directory, not a
          // separate suite someone has to remember to run.
          include: [
            'lib/__tests__/**/*.test.*',
            'lib/**/__tests__/**/*.test.*',
            'ee/**/__tests__/**/*.test.*',
            'scripts/__tests__/**/*.test.*',
          ],
          environment: 'node',
          globals: true,
          env: configEnv,
          typecheck: {
            enabled: true,
            include: ['lib/**/__tests__/**/*.test-d.ts'],
            // Scoped to type-test files only. A repo-wide `tsc --noEmit` would
            // fail on the pre-existing MobileSidebarProps errors in
            // app/phones/* (see CLAUDE.md), and next.config.mjs sets
            // ignoreBuildErrors, so without this the toOwnerScope guarantee
            // would hold in an editor but be unverified in CI.
            //
            // `include` alone is not enough: it selects which files' assertions
            // are collected, but tsc still walks the whole project and reports
            // every error it finds as an unhandled source error. There are 147
            // of those today. ignoreSourceErrors keeps this run failing only on
            // the type assertions below, which is the guarantee being verified.
            ignoreSourceErrors: true,
          },
        },
        resolve: { alias },
      },
    ],
  },
  resolve: { alias },
})
