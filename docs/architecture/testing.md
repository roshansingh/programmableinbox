# Testing

## Unit / component tests (Vitest + MSW + jsdom)

`npm run test` runs the full suite once; `npm run test:watch` for development.

- `test/setup.ts` starts [MSW](https://mswjs.io/) with `onUnhandledRequest: 'error'` — **every
  fetch call made during a test needs a handler** in `test/mocks/handlers.ts`, or an override in
  the test itself. An unhandled request fails the test rather than silently hitting the network.
- `next/navigation`, `next/link`, and `next-themes` are mocked globally in setup.
  `localStorage` is cleared between tests, `window.confirm` returns `true`, and
  `navigator.clipboard` is stubbed. Since the session moved from `localStorage` to an httpOnly
  cookie, `test/setup.ts`'s `afterEach` also calls `clearMockSessionCookie()` (from
  `test/mocks/session-cookie.ts`) alongside `localStorage.clear()`, so a signed-in fixture set up
  by one test (via `setMockSessionCookie()`) can't leak into the next.
- `vitest.config.ts` sets `NEXT_PUBLIC_API_MODE=local` and aliases `@` to the repo root, matching
  `tsconfig.json`.
- **`AUTH_RATE_LIMIT_ENABLED=false` in the test baseline**, unlike production. Suites that
  actually exercise the limiter turn it on explicitly (`withConfigEnv`) and inject a `FakeRedis`.
  Leaving the default on would mean any suite that touches a real `REDIS_URL` fixture shares
  counters across test runs — running `npm test` a few times within the same hour would trip the
  register limit on tests that have nothing to do with rate limiting, while CI (with no Redis on
  6379) stayed green and never caught it.
- Component tests live in `components/__tests__/` and colocated `__tests__/` directories next to
  the code they cover.

Run a single file:

```bash
npx vitest run --project ui components/__tests__/emails-list.test.tsx
npx vitest run --project node lib/__tests__/logger.test.ts
```

## Integration tests (real Postgres)

`npm run test:integration` runs `test/integration/**` against a real database, with no mocks for
the database or auth layer. These are excluded from `npm test` and run separately.

- Requires `.env.test` with `TEST_DATABASE_URL` pointing at a **dedicated** database whose name
  contains `test` — a safety guard refuses anything else, since the suite `TRUNCATE`s every table
  it can reach.
- The database is created, migrated, and dropped per run (`KEEP_TEST_DB=1` to keep it around
  between runs for faster iteration).
- `vitest.integration.config.ts` loads `.env.test` itself and deliberately does **not** load
  `.env` — pulling in the development `DATABASE_URL` would point a truncating test suite at real
  data. It uses `override: false`, so a variable genuinely exported in the shell still wins,
  letting CI inject the URL directly without a file.

Every other variable the app needs to boot (`JWT_SECRET`, `WEBHOOK_SECRET`, `HEALTHZ_SECRET`,
`AUTOMATION_SWEEPER_SECRET`, the `AUTH_*` family, `EMAIL_INBOX_DOMAINS`) is assigned
unconditionally by `test/integration/setup/setup.ts` and **cannot** be overridden from
`.env.test`. They're fixtures, not deployment config — nothing in the suite asserts anything
about their actual values, so a run whose outcome depends on what an operator happened to type in
isn't reproducible. This isn't a hypothetical: a local `.env.test` once carried a `JWT_SECRET`
one character under the 16-character floor `lib/config` enforces, and every one of 233 tests
failed with a `ConfigError` raised at the first call to `signToken` — nowhere near the file that
was actually wrong. Unconditional assignment means a bad value an operator already has can't sit
there, armed, waiting to be reproduced by someone else's `.env.test`.

## Related

- [configuration.md](configuration.md) — the config system these fixtures exercise
