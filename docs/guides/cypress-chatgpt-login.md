# Logging in to chatgpt.com from Cypress with a PIBX inbox

ChatGPT can sign you in with a one-time code sent to your email address. If that address is a
ProgrammableInbox (PIBX) inbox, a Cypress test can read the code through the API instead of a
human opening a mailbox. This guide wires that up with `cy.task`, `cy.origin` and `cy.session`.

> **Read this first**
>
> - **The ChatGPT selectors below are best-effort.** OpenAI changes the login pages often and
>   we have not pinned them to a version. The PIBX half (inbox, code retrieval) is stable and
>   documented in the OpenAPI spec; the page half you will likely need to adjust. Inspect the
>   live page and fix the `data-testid`/`name`/label selectors in step 4.
> - **Expect bot detection.** chatgpt.com sits behind Cloudflare. Cypress runs a real
>   browser, but a challenge page can still appear, especially headless, from datacenter IPs
>   or after repeated logins. That is outside PIBX's control. Cache the session (step 6) so you
>   log in rarely, and see [When it doesn't work](#when-it-doesnt-work).
> - **Check OpenAI's terms** before automating logins, and use a dedicated test account, never
>   a personal one. This guide is for testing your own integration with an account you own.

## How it fits together

```
Cypress spec ──cy.task──▶ Node process ──HTTPS──▶ PIBX  GET /api/v1/emailInbox/{id}/otp
     │                    (holds sk_live_ key)
     └─cy.origin──▶ chatgpt.com ─ emails a code ─▶ your PIBX inbox
```

The API key lives only in the Cypress Node process. It is never serialised into the browser,
the spec, videos or screenshots, because the PIBX calls are made from `cy.task` handlers.

## Prerequisites

1. A PIBX API key (`sk_live_…`, created in the dashboard under **API Keys**) with scopes:
   - `email_messages:read` — required, reads the extracted code
   - `email_inboxes:read` — required, lists/looks up the inbox
   - `email_inboxes:create` — only for the one-time setup in step 1
2. A PIBX inbox on a domain your deployment allows (`EMAIL_INBOX_ALLOWED_DOMAINS`).
3. A ChatGPT account registered **with that inbox's address**.
4. Cypress 13 or later (the guide uses `cy.origin`, `cy.session` and `cy.task`) and Node 18+
   (global `fetch`).

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
yourself (read it with `GET /api/v1/emailInbox/{id}/messages` or in the PIBX dashboard).

## 2. Environment

Put these in `cypress.env.json` (git-ignored) or your CI secret store:

```json
{
  "PIBX_BASE_URL": "https://app.programmableinbox.com",
  "PIBX_API_KEY": "sk_live_...",
  "PIBX_INBOX_ID": "inbx_...",
  "CHATGPT_EMAIL": "qa-login-7f3k@your-allowed-domain.com"
}
```

Add `cypress.env.json` to `.gitignore`. In CI, export the same names as
`CYPRESS_PIBX_API_KEY` etc. — Cypress strips the `CYPRESS_` prefix.

## 3. Register the Node tasks

`cypress.config.ts`:

```ts
import { defineConfig } from 'cypress'

type OtpArgs = {
  inboxId: string
  /** Substring of the From header, e.g. "openai.com". Narrows to the right sender. */
  from?: string
  /** ISO timestamp. Codes from messages created before this are ignored. */
  since: string
  timeoutMs?: number
}

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // cypress.env.json and CYPRESS_* variables land in config.env, not process.env.
      const baseUrl = String(config.env.PIBX_BASE_URL ?? 'https://app.programmableinbox.com')
      const headers = { Authorization: `Bearer ${config.env.PIBX_API_KEY}` }

      on('task', {
        /** Remember "now" so a code already sitting in the inbox is never reused. */
        'pibx:now': () => new Date().toISOString(),

        /** Poll PIBX until a code newer than `since` arrives, or time out. */
        async 'pibx:waitForOtp'({ inboxId, from, since, timeoutMs = 60_000 }: OtpArgs) {
          const deadline = Date.now() + timeoutMs
          const sinceMs = Date.parse(since)

          // withinMinutes has a 1-minute floor and the endpoint answers 404 until a
          // code exists, so we poll and check createdAt ourselves.
          const url = new URL(`/api/v1/emailInbox/${inboxId}/otp`, baseUrl)
          url.searchParams.set('withinMinutes', '15')
          if (from) url.searchParams.set('from', from)

          while (Date.now() < deadline) {
            const res = await fetch(url, { headers })

            if (res.ok) {
              const { data } = (await res.json()) as {
                data: { otp: string; message: { createdAt: string } }
              }
              if (Date.parse(data.message.createdAt) >= sinceMs) return data.otp
              // Older code from a previous run: keep waiting for the new one.
            } else if (res.status !== 404) {
              // 401/403 are config errors; retrying will not fix them.
              throw new Error(`PIBX returned ${res.status}: ${await res.text()}`)
            }

            await new Promise((r) => setTimeout(r, 2_000))
          }
          throw new Error(`No code from "${from ?? 'any sender'}" arrived within ${timeoutMs}ms`)
        },
      })
    },
  },
})
```

Two details that matter:

- **The `since` check is not optional.** The endpoint returns the *latest* code in the window.
  Without comparing `createdAt` to the moment you requested the code, a rerun within 15 minutes
  types the previous run's code and fails in a way that looks like a bad selector.
- **Tasks must return a value or `null`**, never `undefined`. The code above always returns a
  string or throws.

## 4. Add typed custom commands

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
      // Note the time *before* triggering the email.
      cy.task<string>('pibx:now').then((since) => {
        cy.origin(
          'https://chatgpt.com',
          { args: { email } },
          ({ email }) => {
            cy.visit('/auth/login')
            // Selectors: verify against the live page (see "Read this first").
            cy.contains('button', /log in/i).click()
            cy.get('input[type="email"], input[name="email"]').type(email)
            cy.contains('button', /continue/i).click()
          },
        )

        // PIBX calls stay outside cy.origin: callbacks can't use closures,
        // require() or cy.task-with-secrets from the outer scope.
        cy.task<string>(
          'pibx:waitForOtp',
          {
            inboxId: Cypress.env('PIBX_INBOX_ID'),
            from: 'openai.com',
            since,
            timeoutMs: 90_000,
          },
          { timeout: 100_000 }, // cy.task has its own 60s default
        ).then((code) => {
          cy.origin('https://chatgpt.com', { args: { code } }, ({ code }) => {
            cy.get('input[autocomplete="one-time-code"], input[name="code"]').type(code)
            cy.contains('button', /continue|verify/i).click()
          })
        })
      })
    },
    {
      validate() {
        // Cheap proof the session is still good: an authenticated page loads
        // without bouncing to /auth/login.
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
- The `cy.task` calls sit between two `cy.origin` blocks because the secret-holding Node
  process, not the browser, must talk to PIBX.

Import the file from `cypress/support/e2e.ts`:

```ts
import './commands'
```

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
Cloudflare's patience and your PIBX rate limit. Use `cy.session`'s `validate()` to detect
expiry rather than catching failures downstream.

The 2-second poll interval in step 3 is about 30 requests for a 60-second wait. Keep it
modest: the API may throttle a key that polls aggressively.

## When it doesn't work

| Symptom | Likely cause | What to do |
|---|---|---|
| Task throws `PIBX returned 401` | Wrong or revoked key | Check `CYPRESS_PIBX_API_KEY`; the key is shown once at creation. |
| `PIBX returned 403` | Key lacks `email_messages:read` | Create a key with that scope. |
| Waits the full timeout, no code | Mail never arrived, or `from` filter too narrow | Open the PIBX dashboard; check the message's `From` and loosen `from`. |
| Types a wrong or expired code | `since` not passed, or clock skew | Make sure `pibx:now` runs before the "continue" click; run Cypress on a machine with sane NTP. |
| Cypress sees a "Just a moment…" / challenge page | Cloudflare bot check | Run headed, use a residential/office IP, rely on `cy.session` caching. Do not try to defeat the challenge from the test. |
| `cy.origin` errors about `session` or `import` | Wrong nesting | `cy.session` outside, `cy.origin` inside, only `args` crossing in. |
| Selector not found | The ChatGPT page changed | Update step 4's selectors against the live DOM. |

## Related

- [`docs/architecture/mcp-server.md`](../architecture/mcp-server.md) — the same
  `pibx_email_get_latest_otp` lookup via MCP, for agent-driven flows.
- [`sdk/typescript`](../../sdk/typescript/README.md) — generated client, if you'd rather not
  call `fetch` directly in your tasks.
- OpenAPI: `GET /api/v1/emailInbox/{id}/otp` in `lib/openapi/email-inboxes.ts`.
