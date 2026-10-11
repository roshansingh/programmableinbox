# Logging in to chatgpt.com from Cypress with a PIBX inbox

ChatGPT can sign you in with a one-time code sent to your email address. If that address is a
ProgrammableInbox (PIBX) inbox, a Cypress test can read the code through the API instead of a
human opening a mailbox. This guide uses [`@programmableinbox/testing`](../../sdk/testing/README.md)
together with `cy.origin` and `cy.session`.

> **Read this first**
>
> - **The ChatGPT selectors below are best-effort.** OpenAI changes the login pages often and
>   we have not pinned them to a version. The PIBX half (inbox, code retrieval) is stable and
>   covered by the package's tests; the page half you will likely need to adjust. Inspect the
>   live page and fix the label/`name` selectors in step 4.
> - **Expect bot detection.** chatgpt.com sits behind Cloudflare. Cypress runs a real
>   browser, but a challenge page can still appear, especially headless, from datacenter IPs
>   or after repeated logins. That is outside PIBX's control. Cache the session (step 6) so you
>   log in rarely, and see [When it doesn't work](#when-it-doesnt-work).
> - **Check OpenAI's terms** before automating logins, and use a dedicated test account, never
>   a personal one. This guide is for testing your own integration with an account you own.

## How it fits together

```
Cypress spec ──cy.pibxOtp──▶ Node process ──HTTPS──▶ PIBX  GET /api/v1/emailInbox/{id}/otp
     │                       (holds sk_live_ key)
     └─cy.origin──▶ chatgpt.com ─ emails a code ─▶ your PIBX inbox
```

The API key lives only in the Cypress Node process. `pibxTasks` removes `PIBX_API_KEY` from
`config.env` as it registers, so `Cypress.env()` in a spec cannot read it and it never reaches
the Settings panel, the command log or videos. (Call it from `setupNodeEvents` and return the
same `config`, as in step 3.)

`cy.pibxOtp` reads the PIBX server's clock, runs the action you give it (the click that makes
ChatGPT send the email), then waits only for a code that arrived **after** that moment. A code
left in the inbox by a previous run is never returned.

## Prerequisites

1. A PIBX API key (`sk_live_…`, created in the dashboard under **API Keys**) with scopes:
   - `email_messages:read` — required, reads the extracted code
   - `email_inboxes:create` — only for the one-time setup in step 1
2. A PIBX inbox on a domain your deployment allows (`EMAIL_INBOX_ALLOWED_DOMAINS`).
3. A ChatGPT account registered **with that inbox's address**.
4. Cypress 13 or later and Node 18+.

```bash
npm i -D @programmableinbox/testing
```

> Until the package is published to npm, install it from a checkout of this repository. Install
> and build the package there first, because a folder install does not fetch its dev dependencies:
>
> ```bash
> (cd /path/to/repo/sdk/testing && npm install)   # also builds it
> npm i -D /path/to/repo/sdk/testing
> ```

## 1. Create the inbox (once)

A ChatGPT account is identified by its email address, so the inbox is the account's identity.
Create it **once** and reuse it for every run — not one per test.

> **Addresses are permanent.** A PIBX inbox address can never be reclaimed after deletion, so
> don't create-and-delete inboxes in a loop. Also avoid brand terms in the local part:
> `openai`, `chatgpt` and many other brands are rejected by the impersonation blocklist (422).

```bash
curl -X POST "$PIBX_BASE_URL/api/v1/emailInbox" \
  -H "Authorization: Bearer $PIBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "qa-login-7f3k@your-allowed-domain.com", "name": "QA login"}'
```

The response is `{ "data": { "id": "inbx_…", "email": "…" } }`. Keep the `id`.

Then register the ChatGPT account with that address by hand, completing the verification email
yourself (read it in the PIBX dashboard or with `GET /api/v1/emailInbox/{id}/messages`).

## 2. Environment

Put these in `cypress.env.json` (git-ignored) or your CI secret store:

```json
{
  "PIBX_API_KEY": "sk_live_...",
  "PIBX_INBOX_ID": "inbx_...",
  "CHATGPT_EMAIL": "qa-login-7f3k@your-allowed-domain.com"
}
```

Add `cypress.env.json` to `.gitignore`. In CI, export the same names as
`CYPRESS_PIBX_API_KEY` etc. — Cypress strips the `CYPRESS_` prefix.

Optional: `PIBX_BASE_URL` for a self-hosted instance, and `PIBX_POLL_INTERVAL_MS` (default
`5000`) to change how often the inbox is checked.

## 3. Register the package

`cypress.config.ts`:

```ts
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

`cypress/support/e2e.ts`:

```ts
import '@programmableinbox/testing/cypress/support'
import './commands'
```

That is the whole integration. The support import adds `cy.pibxOtp()` and friends, with types.

## 4. Add a login command

`cypress/support/commands.ts`:

```ts
declare global {
  namespace Cypress {
    interface Chainable {
      /** Signs in to chatgpt.com using a one-time code from the PIBX inbox. */
      chatgptLogin(email: string): Chainable<void>
    }
  }
}

Cypress.Commands.add('chatgptLogin', (email: string) => {
  cy.session(
    ['chatgpt', email],
    () => {
      cy.origin('https://chatgpt.com', { args: { email } }, ({ email }) => {
        cy.visit('/auth/login')
        // Selectors: verify against the live page (see "Read this first").
        cy.contains('button', /log in/i).click()
        cy.get('input[type="email"], input[name="email"]').type(email)
      })

      cy.pibxOtp({
        from: 'openai.com',
        timeoutMs: 90_000,
        // The click that makes ChatGPT send the code. Server time is read first.
        after: () => {
          cy.origin('https://chatgpt.com', () => {
            cy.contains('button', /continue/i).click()
          })
        },
      }).then((code) => {
        cy.origin('https://chatgpt.com', { args: { code } }, ({ code }) => {
          cy.get('input[autocomplete="one-time-code"], input[name="code"]').type(code)
          cy.contains('button', /continue|verify/i).click()
        })
      })
    },
    {
      validate() {
        // Cheap proof the session is still good.
        cy.request({ url: 'https://chatgpt.com/api/auth/session', failOnStatusCode: false })
          .its('body.user')
          .should('exist')
      },
      cacheAcrossSpecs: true,
    },
  )
})

export {}
```

Why it is shaped this way:

- `cy.session()` is the **outer** call. It cannot be called inside `cy.origin()`; put
  `cy.origin()` inside the session setup instead.
- Values cross into `cy.origin()` only through `args`, which must be structured-cloneable
  (strings are fine). Nothing from the surrounding scope is visible inside the callback.
- `cy.pibxOtp` sits *between* `cy.origin` blocks because it talks to PIBX from the Node side,
  where the key lives. `after` may contain Cypress commands (including `cy.origin`) but not
  promises.

## 5. Use it in a spec

```ts
describe('chatgpt.com', () => {
  it('logs in with an emailed code', () => {
    cy.chatgptLogin(Cypress.env('CHATGPT_EMAIL'))

    cy.visit('https://chatgpt.com')
    cy.url().should('not.include', '/auth')
  })
})
```

Run it:

```bash
npx cypress run --spec cypress/e2e/chatgpt-login.cy.ts
# or interactively
npx cypress open
```

## 6. Session caching and rotation

`cy.session()` caches cookies per `['chatgpt', email]`, so only the first test in a run (or the
first after the session expires) does the emailed-code dance. That is what keeps you below
Cloudflare's patience and your PIBX request volume. Use `validate()` to detect expiry rather than
catching failures downstream.

The default poll interval is 5 seconds — about 12 requests for a 60-second wait. Raise it
(`PIBX_POLL_INTERVAL_MS`, or `pollIntervalMs` on the command) rather than lowering it: the API
may throttle a key that polls aggressively.

Run specs that log in by emailed code **serially**. Two tests waiting on the same inbox can take
each other's code.

## When it doesn't work

| Symptom | Likely cause | What to do |
|---|---|---|
| `PibxAuthError` (401) | Wrong or revoked key | Check `PIBX_API_KEY`; the key is shown once at creation. |
| `PibxAuthError` (403) | Key lacks `email_messages:read` | Create a key with that scope. |
| `PIBX API key is missing` / `No inbox id` | Variable not reaching Cypress | Use `cypress.env.json` or `CYPRESS_`-prefixed CI variables. |
| `PibxHttpError` … `says the inbox was not found` | Wrong `PIBX_INBOX_ID`, or a key from a different organization | Copy the inbox id again; check the key and the inbox are in the same org. This fails immediately, before your action runs. |
| `PibxTimeoutError`, `last status 404: No message with a one-time code…` | Mail never arrived, or `from` too narrow | Open the PIBX dashboard; check the message's `From` and loosen `from`. |
| `PibxTimeoutError`, `last status 200: the newest code … is older than since` | An old code is still in the inbox and no new mail arrived | Same as above: the action may not have sent an email (selector, bot challenge). |
| `PibxTimeoutError` with `last error: …` | PIBX unreachable | Check `PIBX_BASE_URL` and the network from the Cypress machine. |
| Cypress sees a "Just a moment…" challenge page | Cloudflare bot check | Run headed, use a residential/office IP, rely on `cy.session` caching. Do not try to defeat the challenge from the test. |
| `cy.origin` errors about `session` or `import` | Wrong nesting | `cy.session` outside, `cy.origin` inside, only `args` crossing in. |
| Selector not found | The ChatGPT page changed | Update step 4's selectors against the live DOM. |

## Related

- [`sdk/testing/README.md`](../../sdk/testing/README.md) — the package reference, including
  Playwright and plain-Node usage.
- [`docs/architecture/mcp-server.md`](../architecture/mcp-server.md) — the same
  `pibx_email_get_latest_otp` lookup via MCP, for agent-driven flows.
- OpenAPI: `GET /api/v1/emailInbox/{id}/otp` in `lib/openapi/email-inboxes.ts`.
