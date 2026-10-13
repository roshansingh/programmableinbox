# `@programmableinbox/testing` — Cypress and Playwright helpers

Status: draft for review. No implementation exists yet.

## Purpose

Let a team use a PIBX inbox in end-to-end tests — claim an address, trigger an email, wait for
the one-time code or message — without hand-writing the polling, staleness and key-handling code
that `docs/guides/cypress-chatgpt-login.md` currently asks them to paste.

Success looks like: the Cypress guide shrinks from ~60 lines of `cypress.config.ts` plus a custom
command to one `import` in each of two files, and a Playwright user gets the same capability with
a single fixture.

## Non-goals

- Not a general PIBX client. The generated `@programmableinbox/sdk` already is one.
- No ChatGPT-specific (or any site-specific) login logic. Site flows change weekly and belong in
  user code or guides.
- No inbox mutation beyond create/delete, and no send. The package inherits the MCP/v1 stance
  that tests read mail.
- No bot-detection evasion of any kind.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Shape | One package, subpath exports `.`, `./cypress`, `./playwright` | One release pipeline, one version; frameworks stay optional peers. |
| Core transport | Global `fetch`, zero runtime dependencies | The generated SDK is large and tracks the API at its own cadence; tests need four calls. Node 18+. |
| Where the key lives | Node process only | Cypress via `cy.task`, Playwright runs in Node already. The key never reaches the browser, video or trace. |
| Staleness | Core compares message `createdAt` to a caller-supplied `since` | The OTP endpoint returns the latest code in a window with a 1-minute floor; without this a rerun types the previous run's code. |
| Waiting | Client-side poll, default 2s interval, 60s timeout | The endpoint is a single read that 404s until a code exists. No server change needed. |
| Inbox lifecycle | Package never auto-creates or auto-deletes | Addresses are permanent once created; create-per-test would exhaust them, and a ChatGPT-style account is bound to one address. `createInbox` exists but is explicit. |

## Public API

### Core (`@programmableinbox/testing`)

```ts
createPibxClient(options?: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch }): PibxClient

interface PibxClient {
  createInbox(input: { email: string; name?: string }): Promise<Inbox>
  waitForOtp(input: {
    inboxId: string
    since: Date | string      // required, not defaulted
    from?: string             // substring of the From header
    timeoutMs?: number        // default 60_000
    pollIntervalMs?: number   // default 2_000
  }): Promise<{ otp: string; message: Message }>
  waitForMessage(input: {
    inboxId: string
    since: Date | string
    from?: string
    subject?: string          // substring
    timeoutMs?: number
    pollIntervalMs?: number
  }): Promise<Message>
}
```

`apiKey` defaults to `PIBX_API_KEY`, `baseUrl` to `PIBX_BASE_URL`, then
`https://app.programmableinbox.com`. A missing key throws at construction naming the variable —
the same set-but-invalid-or-absent-throws posture `lib/config` uses.

`since` is deliberately required. A default of "now" would be set at call time, after the email
may already have arrived, and would silently drop the code being waited for.

Errors are typed (`PibxAuthError` for 401/403, `PibxTimeoutError` carrying the last status and
the `from` filter, `PibxHttpError` otherwise). 401/403 never retry; 404 and 5xx retry until the
deadline.

### Cypress (`@programmableinbox/testing/cypress`)

Node half, in `cypress.config.ts`:

```ts
import { pibxTasks } from '@programmableinbox/testing/cypress'
setupNodeEvents(on, config) { pibxTasks(on, config) ; return config }
```

Registers tasks `pibx:now`, `pibx:createInbox`, `pibx:waitForOtp`, `pibx:waitForMessage`. Reads
`PIBX_API_KEY` / `PIBX_BASE_URL` from `config.env` (not `process.env`; Cypress puts
`cypress.env.json` and `CYPRESS_*` there).

Browser half, in `cypress/support/e2e.ts`:

```ts
import '@programmableinbox/testing/cypress/support'
```

Adds `cy.pibxNow()`, `cy.pibxWaitForOtp(opts)`, `cy.pibxWaitForMessage(opts)` with `Chainable`
type augmentation shipped in the package's `.d.ts`. Sets a task timeout slightly above the
poll timeout so Cypress's own 60s `cy.task` default doesn't cut a longer wait short.

### Playwright (`@programmableinbox/testing/playwright`)

```ts
import { test as base, expect } from '@playwright/test'
import { pibxFixtures } from '@programmableinbox/testing/playwright'
export const test = base.extend(pibxFixtures)
```

Provides a `pibx` fixture (the core client, configured from options/env) and option fixtures
`pibxApiKey`, `pibxBaseUrl` settable per project in `playwright.config.ts`. Exported as a plain
fixture object so `mergeTests` composes with a user's own fixtures. Test-scoped; the client is
stateless so there is nothing to tear down.

## Package layout

```
sdk/testing/
  package.json          exports map, peerDependencies (cypress, @playwright/test) both optional
  tsconfig.json
  src/
    index.ts            re-exports core
    client.ts           createPibxClient
    poll.ts             deadline/interval loop, injectable clock for tests
    errors.ts
    cypress/index.ts    pibxTasks
    cypress/support.ts  commands + type augmentation
    playwright/index.ts pibxFixtures
  README.md
```

Hand-written, so it sits beside the generated SDKs but outside `sdk/generate.sh` (which names
each language directory explicitly) and is not covered by `.openapi-generator-ignore`.
ESM + CJS builds, as `sdk/typescript` does.

## Testing

- **Core:** vitest in the package against a local `node:http` server standing in for PIBX.
  Cases: code arrives on the Nth poll; a stale code older than `since` is skipped, then the new
  one returned; 404-until-deadline → `PibxTimeoutError`; 401 fails immediately without retry;
  `from` and `withinMinutes` reach the query string; the key is sent only as a bearer header.
  The poll loop takes an injected clock so no test sleeps.
- **Adapters:** one smoke test per framework — a real `cypress run` and a real `playwright test`
  against the same local stub server, asserting a task/fixture round-trips a code. These are
  the tests that catch registration mistakes the unit tests can't.
- **Types:** a `.test-d.ts` asserting `cy.pibxWaitForOtp` is on `Chainable` after the support
  import.
- Per the repo rule, `npm run test` stays green; the package's own suite is wired as an
  additional project and does not need a database or Redis.

## Release

Mirrors the existing SDK jobs in `.github/workflows/release.yml`: the manifest version is the
source of truth, the job publishes only if that version is not already on npm, and a
maintainer bumps it by hand. Needs an `npm` account/token and the `@programmableinbox` scope,
which issue #130 already tracks for `@programmableinbox/sdk`. Until provisioning exists the
job skips cleanly, like the others.

## Open questions

1. **Directory:** `sdk/testing/` (reuses release machinery, but the README there says
   "generated clients") vs. a new top-level `packages/testing/`. Leaning `sdk/testing/`.
2. **Package name:** `@programmableinbox/testing` vs. `@programmableinbox/test-utils`.
3. **Do we ship a `chatgptLogin` helper?** Recommendation: no. It would be the only part of the
   package that breaks without any PIBX change, and it drags in the bot-detection and terms
   concerns. Keep it as the guide.
4. **Retry on 429?** The v1 routes' rate-limit behaviour for key polling isn't verified in this
   spec. Proposal: honour `Retry-After` if present, otherwise treat as retryable up to the
   deadline. Confirm against `lib/security/rate-limit.ts` during implementation.
5. **Cypress minimum version** — the guide says 13+. Confirm `cy.session` +
   `cacheAcrossSpecs` + `cy.origin` behave as documented on the lowest version we claim.
