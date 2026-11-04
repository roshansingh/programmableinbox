# SMS Twilio Foundation (#140) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Twilio config domain and a lazy, error-mapping client wrapper that every later SMS issue (#141, #142, #146, #148) builds on. No routes, no UI, no schema changes.

**Architecture:** A new `sms` domain in `lib/config/schema.ts` (conditionally required on `SMS_ENABLED`, boxed secret, asserted at boot), a cross-domain `APP_BASE_URL` requirement in `assertConfig()`, a `requireSms()` guard in `lib/config/index.ts`, and `lib/sms/twilio-client.ts` modelled on `lib/resend.ts` (lazy construction, never at module load) plus a pure error mapper.

**Tech Stack:** Next.js 16, zod 3, Vitest (`node` project), the official `twilio` npm package.

**Spec:** `docs/superpowers/specs/2026-11-04-sms-inbound-inbox-design.md` (build-order item 1, issue #140).

## Global Constraints

- All env reads go through `lib/config/`; no `process.env` elsewhere (ESLint rule + `no-raw-env.test.ts`).
- Nothing parses at module load: `next build` runs with no secrets. Accessors are lazy and memoized per domain.
- Set-but-invalid always throws; blank (`FOO=`) counts as unset; errors name the variable and constraint, never the value.
- The auth token is a `Secret` (`.reveal()` only at the point of constructing the Twilio client).
- New vars: `SMS_ENABLED` (default `false`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. `SMS_ENABLED=true` requires both, plus `APP_BASE_URL`, asserted at boot.
- Same three env vars for hosted and self-hosted. Hosted uses one platform account (no subaccounts); the modes differ only in plan quota, not in credential resolution.
- SMS lives in `lib/`, not `ee/` — it must exist in Community builds.
- Not added to `AppConfig` (nothing in the dashboard branches on it yet).
- Each task: TDD, one commit. Commit messages end with the attribution lines from the session's system-reminder. Work only in a git worktree (CLAUDE.md); run `npm run test` before opening the PR.

## Review Focus

- `TWILIO_ACCOUNT_SID` set to something malformed (an auth token or an `SK…` API key pasted by mistake) → boot error naming the variable, never echoing the value. Pinned in Task 1.
- `TWILIO_AUTH_TOKEN=` (blank) with `SMS_ENABLED=true` → reported as missing, same as unset. Pinned in Task 1.
- Credentials present but `SMS_ENABLED=false` → no error and `getTwilio()` still refuses to hand out a client. Pinned in Tasks 1 and 3.
- A Twilio error whose message contains the account SID or auth token → mapped error never contains either. Pinned in Task 3.
- Importing `lib/sms/twilio-client.ts` with no SMS env at all must not throw (the `next build` case); a thrown non-`Error` value or a network error with no HTTP status maps to `unavailable`/`unknown` rather than crashing. Pinned in Task 3.

---

### Task 0: Worktree and baseline

**Files:**
- Create: `docs/superpowers/specs/2026-11-04-sms-inbound-inbox-design.md` and `docs/superpowers/plans/2026-11-04-sms-twilio-foundation.md` (copied from the current checkout, where they are uncommitted)

- [ ] **Step 1:** Use `superpowers:using-git-worktrees` to create a worktree on branch `feat/sms-twilio-foundation` from `main`.
- [ ] **Step 2:** Copy the two docs above into the worktree and commit as `docs: SMS inbound design and #140 plan`.
- [ ] **Step 3:** Run `npm install && npm run test`. Expected: all pass (baseline, 334+ tests). Record the count.

### Task 1: `sms` config domain

**Files:**
- Modify: `lib/config/schema.ts` (new `SmsSchema` after `ProductAnalyticsSchema`; new `sms` entry in `DOMAIN_SCHEMAS`)
- Modify: `.env.example` (document the three vars)
- Test: `lib/config/__tests__/schema-sms.test.ts` (model on `schema-observability.test.ts`)

**Interfaces:**
- Produces: `config.sms: { enabled: boolean; accountSid: string | null; authToken: Secret | null }`, domain name `'sms'`, vars `['SMS_ENABLED', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']`.

- [ ] **Step 1: Write the failing tests** in `schema-sms.test.ts` using `parseDomain('sms')` and the same `withEnv`/`afterEach` restore helper as the observability suite:
  - `it('is off by default, with no credentials required')` → `enabled === false`, `accountSid === null`, `authToken === null`.
  - `it('parses a complete configuration')` with `SMS_ENABLED=true`, `TWILIO_ACCOUNT_SID='AC' + 'a'.repeat(32)`, `TWILIO_AUTH_TOKEN='t'.repeat(32)` → `enabled`, `accountSid` equal, `authToken?.reveal()` equal.
  - `it('requires both credentials when enabled')` → throws `ConfigError` whose `variables` contains `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
  - `it('treats a blank TWILIO_AUTH_TOKEN as missing')` (`TWILIO_AUTH_TOKEN=''`, enabled) → throws with `variables` containing `TWILIO_AUTH_TOKEN`.
  - `it('rejects a malformed account SID without echoing it')` for `'SK' + 'a'.repeat(32)` and `'x'.repeat(32)` → throws; `error.message` contains `TWILIO_ACCOUNT_SID` and does not contain the supplied value.
  - `it('ignores credentials while disabled')` → credentials set, `SMS_ENABLED` unset → no throw, `enabled === false`, `accountSid` populated.
  - `it('boxes the auth token')` → `String(authToken) === '[redacted]'` and `JSON.stringify(config)` does not contain the token.
- [ ] **Step 2:** Run `npx vitest run --project node lib/config/__tests__/schema-sms.test.ts`. Expected: FAIL (unknown domain `sms`).
- [ ] **Step 3: Implement `SmsSchema`** in `lib/config/schema.ts`, following `ObservabilitySchema`: `SMS_ENABLED: zBool.optional()`, `TWILIO_ACCOUNT_SID: zNonEmpty.optional()` refined with `/^AC[0-9a-fA-F]{32}$/` (message: `must be a Twilio Account SID (AC followed by 32 hex characters); API keys (SK...) are not supported`), `TWILIO_AUTH_TOKEN: zSecret().optional()`; a `superRefine` adding `'is required when SMS_ENABLED is true'` for each missing credential; `transform` to the shape above. Register it as `sms` in `DOMAIN_SCHEMAS`. Add a doc comment explaining off-by-default (on the `COMMERCIAL_ENABLED` precedent) and the one-platform-account decision.
- [ ] **Step 4: Document in `.env.example`** under a new "SMS" heading: `# SMS_ENABLED=false`, `# TWILIO_ACCOUNT_SID=`, `# TWILIO_AUTH_TOKEN=`, noting SMS also needs `APP_BASE_URL` and is receive-only.
- [ ] **Step 5:** Run `npx vitest run --project node lib/config`. Expected: PASS, including `env-example.test.ts`.
- [ ] **Step 6: Commit** `feat(sms): add sms config domain`.

### Task 2: Boot-time `APP_BASE_URL` requirement and `requireSms()`

**Files:**
- Modify: `lib/config/assert.ts` (cross-domain check, after the `REDIS_URL` block)
- Modify: `lib/config/index.ts` (add `requireSms`)
- Test: `lib/config/__tests__/assert.test.ts`, `lib/config/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `config.sms`, `config.emailVerification.appBaseUrl` (Task 1, existing).
- Produces: `requireSms(): { accountSid: string; authToken: string; appBaseUrl: string }` — throws `ConfigError` (variables = the missing names) when `SMS_ENABLED` is false or any value is null.

- [ ] **Step 1: Write the failing tests.**
  - In `assert.test.ts`, using `setValidEnv()`: `it('refuses to boot with SMS_ENABLED and no APP_BASE_URL')` → throws, message contains `APP_BASE_URL` and `SMS_ENABLED`; `it('passes with SMS fully configured')` (credentials + `APP_BASE_URL=https://app.example.com`); `it('does not report APP_BASE_URL twice when EMAIL_VERIFICATION_ENABLED already failed on it')` → the name appears once in the message.
  - In `index.test.ts`: `requireSms()` throws naming `SMS_ENABLED` when disabled; throws naming each missing variable when enabled-but-incomplete (use `parseDomain` bypass by setting env then `resetConfigCache()`); returns revealed strings when complete.
- [ ] **Step 2:** Run `npx vitest run --project node lib/config/__tests__/assert.test.ts lib/config/__tests__/index.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the `assert.ts` block mirroring the `REDIS_URL` one (only when `APP_BASE_URL` is not already in `variables`; message `APP_BASE_URL is required when SMS_ENABLED is true` with a one-line reason: the webhook URL registered with Twilio, and the one its signature covers, must not come from `Host`). Implement `requireSms()` beside `requireEmailVerification()`, same message style and comment explaining the guard-for-callers-that-forgot-to-check pattern.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sms): require APP_BASE_URL at boot when SMS is enabled`.

### Task 3: Twilio client and error mapping

**Files:**
- Modify: `package.json` / `package-lock.json` (`npm install twilio`)
- Create: `lib/sms/twilio-client.ts`, `lib/sms/errors.ts`
- Test: `lib/sms/__tests__/twilio-client.test.ts`, `lib/sms/__tests__/errors.test.ts`

**Interfaces:**
- Consumes: `requireSms()` (Task 2).
- Produces:
  - `getTwilio(): Twilio` — lazy singleton; calls `requireSms()` on first use; module scope holds `let client: Twilio | null = null`, as `lib/resend.ts` does.
  - `resetTwilioClientForTests(): void`.
  - `type SmsProviderErrorKind = 'auth' | 'invalid-request' | 'not-found' | 'rate-limited' | 'unavailable' | 'unknown'`
  - `class SmsProviderError extends Error { kind: SmsProviderErrorKind; status: number | null; twilioCode: number | null }`
  - `mapTwilioError(err: unknown): SmsProviderError` — pure.
  - `callTwilio<T>(fn: (client: Twilio) => Promise<T>): Promise<T>` — runs `fn(getTwilio())`, rethrows any failure through `mapTwilioError`, and `logger.error({ error }, 'twilio request failed')` before rethrowing.

- [ ] **Step 1: Write the failing tests.** Mock `twilio` with `vi.mock('twilio', ...)` returning a constructor spy.
  - `errors.test.ts`: table test of `mapTwilioError` — status 401/403 → `auth`; 400 → `invalid-request`; 404 → `not-found`; 429 → `rate-limited`; 500/503 → `unavailable`; an `Error` with `code: 'ECONNRESET'` and no status → `unavailable`; a thrown string and `undefined` → `unknown`; `twilioCode` copied from `err.code` when numeric. `it('never includes the account SID or auth token in the message')` — error text containing both → `message` contains neither (they are replaced by `[redacted]`).
  - `twilio-client.test.ts`: `it('can be imported with no SMS environment')`; `it('refuses to build a client while SMS_ENABLED is false, even with credentials set')` → throws `ConfigError` naming `SMS_ENABLED`; `it('builds one client from config and reuses it')` → constructor called once with the SID and the revealed token across two `getTwilio()` calls; `it('callTwilio maps failures')` → a rejected `{ status: 401 }` surfaces as `SmsProviderError` with `kind === 'auth'`.
- [ ] **Step 2:** Run `npx vitest run --project node lib/sms`. Expected: FAIL (modules missing).
- [ ] **Step 3: Install** `twilio` and confirm the installed version's constructor options include automatic retry (`autoRetry`, `maxRetries`) by reading its type definitions; if present, construct with `{ autoRetry: true, maxRetries: 3 }` (retries only 429/5xx), otherwise construct without retry and note it in the PR.
- [ ] **Step 4: Implement** `errors.ts` and `twilio-client.ts` per the interfaces above. `mapTwilioError` builds its message from kind, status and Twilio code plus the raw message with the SID and token replaced; it does not forward the original error object as `cause` unredacted.
- [ ] **Step 5:** Run `npx vitest run --project node lib/sms lib/config`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(sms): add lazy Twilio client and error mapping`.

### Task 4: Build compatibility and docs

**Files:**
- Modify: `next.config.mjs` (only if needed), `CLAUDE.md`
- Test: none new (verification task)

- [ ] **Step 1:** Run `npm run build` with no SMS env set. Expected: succeeds. If webpack or Turbopack fails to bundle `twilio`, add `'twilio'` to `serverExternalPackages` and re-run until it passes; keep the existing `thread-stream` external untouched.
- [ ] **Step 2:** Add a short "SMS" paragraph to `CLAUDE.md` (config section): the three vars, the `SMS_ENABLED` + `APP_BASE_URL` boot requirement, `requireSms()`, `callTwilio()` and that `SmsProviderError` is what route handlers catch.
- [ ] **Step 3:** Run `npm run lint && npm run test`. Expected: lint clean, test count ≥ baseline plus the new tests.
- [ ] **Step 4: Commit** `docs(sms): document Twilio config and client`, then finish with `superpowers:finishing-a-development-branch`.
