# @programmableinbox/testing

Read a [ProgrammableInbox](https://programmableinbox.com) inbox from your **Cypress** or
**Playwright** tests: trigger an email, wait for the one-time code, type it in.

> **PIBX** is short for ProgrammableInbox: it prefixes this package's environment variables
> (`PIBX_API_KEY`), Cypress commands (`cy.pibxOtp`) and Playwright fixtures (`pibx`).

```ts
// Playwright
const { otp } = await pibx.otpAfter(() => page.getByRole('button', { name: 'Continue' }).click())
await page.getByLabel('Code').fill(otp)
```

```ts
// Cypress
cy.pibxOtp({ after: () => cy.contains('button', 'Continue').click() }).then((code) => {
  cy.get('input[autocomplete=one-time-code]').type(code)
})
```

You never handle timestamps: `otpAfter` / `pibxOtp` read the PIBX server's clock (and the
newest mail already in the inbox), run your action, then wait only for mail that arrived **after**
that moment, so a code left over from a previous run can never be returned.

## Install

```bash
npm i -D @programmableinbox/testing
```

Node 18+. Cypress 13+ and/or `@playwright/test` 1.40+ are optional peers; install the one you use.

## Configure

Three variables cover everything. Set them in your shell, CI secrets, or (Cypress)
`cypress.env.json`:

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PIBX_API_KEY` | yes | — | An `sk_live_…` key. Needs `email_messages:read`; `createInbox` additionally needs `email_inboxes:create`. |
| `PIBX_INBOX_ID` | for the shortcuts | — | The inbox your test account uses. Passing `inboxId` per call overrides it. |
| `PIBX_BASE_URL` | no | `https://app.programmableinbox.com` | Point at a self-hosted instance. |
| `PIBX_POLL_INTERVAL_MS` | no | `5000` | How often to check for mail. Raise it to send fewer requests. |

A set-but-invalid value (for example `PIBX_POLL_INTERVAL_MS=abc`) is an error that names the
variable; it never silently becomes the default.

The key is used in your Node process only. In Cypress, `pibxTasks` **removes `PIBX_API_KEY` from
`config.env`** as it registers, so `Cypress.env()` in a spec cannot read it and it never reaches
the Settings panel, the command log or videos. Call `pibxTasks(on, config)` and return that same
`config` from `setupNodeEvents`, as shown below. (Other `PIBX_*` values are not secret and stay in
`config.env`.)

## Cypress

```ts
// cypress.config.ts
import { defineConfig } from 'cypress'
import { pibxTasks } from '@programmableinbox/testing/cypress'

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      pibxTasks(on, config)
      return config
    },
  },
})
```

```ts
// cypress/support/e2e.ts
import '@programmableinbox/testing/cypress/support'
```

| Command | Yields | Notes |
|---|---|---|
| `cy.pibxOtp({ after?, from?, inboxId?, timeoutMs?, pollIntervalMs? })` | the code (string) | The easy path. `after` runs once server time is read; use Cypress commands in it. |
| `cy.pibxNow({ inboxId? })` | ISO timestamp | Server time. For the low-level pair below. |
| `cy.pibxWaitForOtp({ since, ... })` | the code (string) | `since` is required. |
| `cy.pibxWaitForMessage({ since, subject?, ... })` | the message | Newest match at or after `since`. |
| `cy.pibxCreateInbox({ email, name? })` | `{ id, email }` | One-time setup. See the gotchas. |

## Playwright

```ts
// fixtures.ts
import { test as base } from '@playwright/test'
import { pibxFixtures, type PibxFixtures } from '@programmableinbox/testing/playwright'

export const test = base.extend<PibxFixtures>(pibxFixtures)
export { expect } from '@playwright/test'
```

`pibx` is the client below. Set `pibxApiKey`, `pibxBaseUrl` and `pibxInboxId` per project in
`playwright.config.ts` under `use` if you'd rather not use environment variables. To combine with
your own fixtures use `mergeTests`.

## Plain Node / any runner

```ts
import { createPibxClient } from '@programmableinbox/testing'

const pibx = createPibxClient() // reads PIBX_* from the environment
const { otp, message } = await pibx.otpAfter(() => sendTheEmail(), { from: 'example.com' })
```

| Method | Returns |
|---|---|
| `otpAfter(trigger, { inboxId?, from?, timeoutMs?, pollIntervalMs? })` | `{ otp, message }` |
| `messageAfter(trigger, { subject?, from?, ... })` | `message` |
| `waitForOtp({ since, ... })` / `waitForMessage({ since, ... })` | as above, with an explicit `since` |
| `serverNow(inboxId?)` | a boundary no earlier than the server's time, ISO: its clock, moved past any mail already in the inbox |
| `createInbox({ email, name? })` | the inbox |

### Timing

Default wait is 60 s, polling every 5 s (about 12 requests). Override per call
(`timeoutMs`, `pollIntervalMs`), per client (`createPibxClient({ pollIntervalMs })`), or with
`PIBX_POLL_INTERVAL_MS`. Each HTTP request is also capped (`requestTimeoutMs`, default 15 s), so a
stalled connection can't hold a test past its deadline.

### Errors

| Error | When |
|---|---|
| `PibxAuthError` | 401/403. Not retried: a bad or under-scoped key won't fix itself. |
| `PibxTimeoutError` | The deadline passed. Carries `lastStatus`; with no status the message includes the last network error, so a wrong `PIBX_BASE_URL` is visible. |
| `PibxHttpError` | An unexpected response, including a 200 whose body isn't the documented shape. |
| `TypeError` | `since` isn't a `Date` or ISO-8601 string. |

404, 429 (honouring `Retry-After`) and 5xx are retried until the deadline.

## Gotchas

- **Inbox addresses are permanent.** Once created, an address can never be reclaimed, even after
  deletion. Create one inbox for your test account and reuse it; don't create one per test. This
  package never creates or deletes inboxes unless you call `createInbox`.
- **Brand names are blocked in the local part.** `openai`, `chatgpt` and many others are rejected
  at creation (HTTP 422). Use neutral names such as `qa-login-7f3k`.
- **Use `from` to pick the right mail.** A shared inbox receives everything; `from: 'openai.com'`
  keeps a welcome email from being mistaken for the login code.
- **One inbox, one test at a time.** Two tests waiting on the same inbox can take each other's
  code. Run login-by-email specs serially, or give each worker its own inbox.
- **Don't automate sites you aren't allowed to.** Check the target's terms and use a dedicated
  test account. This package does nothing about bot detection and won't.

See the [step-by-step ChatGPT login guide](https://github.com/roshansingh/programmableinbox/blob/main/docs/guides/cypress-chatgpt-login.md).
