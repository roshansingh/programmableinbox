# ProgrammableInbox — Product Requirements Document

**Status:** Reverse-engineered from the current codebase (2026-05-04). Reflects what is built; gaps and "should" statements are clearly marked.

## 1. Summary

ProgrammableInbox is a multi-tenant web app for receiving, threading, and replying to emails (and, in scaffold form, SMS) at developer-provisioned inbox addresses. It is also an API platform: every UI action is backed by a public, key-authenticated REST surface (`/api/v1/*`) and a webhook system that fans out events to customer endpoints.

The product collapses two roles into one app:
- **End-user UI** — humans triage messages in a Gmail-like inbox view.
- **Developer API** — programs create inboxes, list messages, send replies, and subscribe to events.

## 2. Problem & Goals

### Problem
Building a custom email-receiving backend (MX/SPF, MIME parsing, threading, dedupe, webhook fan-out) is undifferentiated work for product teams that just need a programmable inbox — for support, transactional reply handling, AI agents that read mail, etc.

### Goals
1. Provision a working inbox address in seconds.
2. Reliable receive → store → thread → notify pipeline (no message loss, no duplicates).
3. First-class API parity: anything the UI does is also doable via REST + API key.
4. Multi-tenant from day one: users belong to organizations; resources are org-scoped.

### Non-goals (current scope)
- Outbound deliverability tooling (suppression lists, warm-up, IP pools).
- Spam/abuse classification.
- Phone/SMS messaging — schema and pages exist, but the **only** wired pipeline today is email. Phones are UI scaffolding.
- Team collaboration features (assignments, internal notes, shared seen state).

## 3. Personas

- **Developer (primary).** Wants an API key, a webhook URL, and an inbox address. Will write code against `/api/v1`.
- **Operator / support agent.** Logs into the UI to read and reply to messages on a shared inbox.
- **Org owner.** Same person as Developer in early-stage teams; manages inboxes and keys.

## 4. Core concepts (data model)

Defined in `prisma/schema.prisma`. Names matter — they are the contract.

- **User** — auth identity (email + bcrypt `passwordHash`, JWT 7-day session).
- **Organization** — tenant boundary. All resources are scoped here.
- **Membership** — joins User ↔ Organization with a `role` (default `"owner"`; no role enforcement implemented yet).
- **EmailInbox** — a receiving address (e.g. `support@…`). Owned by both a User and an Organization.
- **PhoneInbox** — analogous to EmailInbox; defined but not delivering messages.
- **EmailMessage** — a single received email. Carries threading fields (`threadId`, `parentMessageId`, `messageId`, `inReplyTo`, `references`), provider id (`externalId`), and full headers + html + text.
- **ApiKey** — bearer credential scoped to an Organization, created by a User.
- **Webhook** — customer endpoint subscribed to an array of `events`, with status (`active | inactive | failing`), per-webhook `secret`, and `lastTriggered`.
- **WebhookEvent** — delivery attempts log (`pending | delivered | failed`, `attempts`, `deliveredAt`).

### Invariants
- `EmailMessage.(externalId, inboxEmailAddressId)` is unique → idempotent ingest.
- `EmailMessage.messageId` is globally unique.
- `Membership.(userId, organizationId)` is unique.
- A new email thread uses the new message's own DB id as its `threadId`.

## 5. Functional requirements

### 5.1 Auth
- Email + password registration and login (`/auth/login`, `/auth/register`).
- JWT issued at login, stored in `localStorage.auth_token`, sent as `Authorization: Bearer <token>`.
- `<AuthProvider>` calls `/api/auth/me` once at app mount; `useAuth()` is the single source of truth for the current user. Other components must not refetch `/auth/me`.
- `<AuthGuard>` redirects unauthenticated users to `/auth/login`; on a 401 the API client wipes the token and redirects (unless already on an auth page).
- Auth enforcement is **per-route via `getAuthenticatedUser(request)`**, not middleware. Every protected handler must call it and return `jsonError('Unauthorized', 401)` on null.

### 5.2 Email inboxes
- Create / list / get / update / delete an `EmailInbox` (`/api/v1/emailInbox`, `[id]`).
- Each inbox has an address, optional display `name`, an org and a user owner.
- UI: dashboard shows inbox cards + a per-inbox detail page at `/emails/[id]`.

### 5.3 Receiving email (Resend webhook)
- `POST /api/webhooks/email` accepts `email.received` events from Resend.
- HMAC validation: `x-webhook-signature` + `x-webhook-timestamp`, verified against `WEBHOOK_SECRET` using `crypto.timingSafeEqual`. **5-minute replay window** by timestamp.
- **Threading rules** (in `determineThreading`):
  1. Match `In-Reply-To` / `References` against existing `EmailMessage.messageId`.
  2. Otherwise, fallback to subject match (strip `Re:`/`Fwd:`) within the same inbox.
  3. Otherwise, start a new thread (use the new message's own id).
- The subject fallback exists because Resend's outgoing `Message-ID` does not always equal the recipient-visible one. **Do not remove.**
- Duplicates are silently dropped on Prisma `P2002` (the `(externalId, inboxEmailAddressId)` unique constraint).

### 5.4 Reading & replying
- `GET /v1/emailInbox/{id}/messages` with `page`, `limit`, optional `threadId`, optional `grouped` (server returns thread-collapsed view).
- `POST /v1/emailInbox/{id}/send` for outbound replies via Resend; supports `to/cc/bcc`, `subject`, `text`, `html`, `inReplyTo`, `references`.
- UI: `/emails/[id]` shows thread list + message detail + compose-reply dialog.

### 5.5 Phone inboxes (scaffolding only)
- Pages: `/phones`, `/phones/[id]`. API: `/api/v1/phoneInbox`, `[id]`.
- CRUD against `PhoneInbox` works; **no message ingestion or send pipeline is wired**. Treat as placeholder for a future SMS provider integration.
- `app/phones/[id]/page.tsx` and `app/phones/page.tsx` carry pre-existing TS errors around `MobileSidebarProps`. Known. Do not drive-by fix.

### 5.6 API keys
- Create / list / revoke API keys per organization (`/app/api-keys`, `/api/v1/apiKeys`).
- Keys are stored in plaintext in `ApiKey.apiKey` today (no hashing). Public-facing API key auth is **not yet enforced** in the v1 routes — current routes authenticate via `getAuthenticatedUser` (JWT). Treat "use API key from a backend" as a near-term gap.

### 5.7 Webhooks
- Customers register a webhook URL with a list of subscribed `events` (`/app/webhooks`, `/api/webhooks`).
- Per-webhook `secret` for HMAC signing of outbound deliveries.
- Status lifecycle: `active → failing → inactive`. `WebhookEvent` rows track `attempts` and `deliveredAt`.
- Retry / backoff policy is **not specified in the schema**; needs to be defined alongside the delivery worker.

## 6. Non-functional requirements

### 6.1 Multi-tenancy & authorization
Two scoping patterns coexist; new routes must match neighbors:
- **User-scoped** (`apiKeys`, `emailInbox`): `where: { userId: user.id }`, then verify the body's `organizationId` is in `user.memberships`.
- **Org-scoped** (`webhooks`): `where: { organizationId: { in: user.memberships.map(...) } }`.

A user must never see resources from an org they are not a member of. There are no per-resource ACLs beyond org membership.

### 6.2 API response envelope (load-bearing)
All routes use `lib/api-helpers.ts`:
- Success: `jsonSuccess(data, status)` → `{ data }`.
- Error: `jsonError(message, status)` → `{ message }`.

`lib/api-client.ts` automatically unwraps `data.data`. **Returning a bare object will silently corrupt the client.** Any new route must use these helpers.

### 6.3 Observability
- No logging/metrics/tracing infrastructure today. Acknowledged gap; should be addressed before opening the API publicly (at minimum: structured request logs + webhook delivery dashboard).

### 6.4 Testing
- Vitest + Testing Library + jsdom, with MSW (`onUnhandledRequest: 'error'`) for fetch mocking.
- `next/navigation`, `next/link`, `next-themes` mocked globally; `localStorage` cleared between tests.
- Component tests live in `components/__tests__/` and `app/api-keys/__tests__/`.
- New features must add tests at the same layer as their neighbors.

### 6.5 Tech stack constraints
- Next.js 16 (App Router). Dynamic route params are async: `{ params }: { params: Promise<{ id: string }> }`, must `await params`.
- Prisma 7, generator `prisma-client` (not `prisma-client-js`), output to `lib/generated/prisma`. Import from `@/lib/generated/prisma/client`. `PrismaClient` requires the `@prisma/adapter-pg` adapter; the singleton lives in `lib/db.ts`.
- React 19, shadcn/ui, Tailwind v4.
- Dev/start ports default to `4000`.

### 6.6 Required environment
`DATABASE_URL`, `JWT_SECRET`, `WEBHOOK_SECRET`, `AUTH_RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`.

All environment variables are read and validated in one place, `lib/config/`, against a zod schema per domain. `assertConfig()` runs at server boot and reports every misconfigured variable at once; a value that is set but malformed is rejected rather than replaced by a default. `.env.example` lists every variable with its format, and `NEXT_PUBLIC_API_MODE` is optional (validated, but nothing branches on it).

## 7. UX surface (current routes)

| Route | Purpose |
| --- | --- |
| `/` | Dashboard: stat cards + email and phone inbox lists |
| `/auth/login`, `/auth/register` | Auth |
| `/emails`, `/emails/[id]` | Email inbox list + thread view + compose-reply |
| `/phones`, `/phones/[id]` | Phone inbox list + detail (UI only, no live data) |
| `/api-keys` | Create / list / revoke API keys |
| `/webhooks` | Manage webhook subscriptions |

## 8. Known gaps & open questions

These are not features that "should" be hidden — they are real holes a future iteration must close.

1. **API key enforcement.** v1 routes don't yet accept the `ApiKey.apiKey` as a credential. Define: header name, hashing at rest, rate limiting, scopes.
2. **Phone messaging pipeline.** Choose provider, define ingest webhook + send endpoint, mirror the email design.
3. **Webhook delivery worker.** Retry policy, backoff, signature scheme, dead-letter handling, UI for `WebhookEvent` history.
4. **Roles.** `Membership.role` defaults to `"owner"` and is never checked. Decide whether non-owner roles ship.
5. **Observability.** Logs / metrics / a "deliveries" dashboard.
6. **Spam & abuse.** No filtering on inbound mail.
7. **Outbound auth records.** Per-org domain provisioning (SPF/DKIM/DMARC) is out of scope today; product depends on Resend's shared sending domain.
8. ~~**`package.json#name`** is still `my-v0-project` from the v0.app scaffold.~~ Renamed to `programmableinbox`; the MCP server reports it to clients as its `serverInfo.name`.

## 9. Success metrics (proposed, not yet instrumented)

- Time from signup → first inbox created → first message received.
- Webhook delivery success rate (rolling 24h).
- p95 ingest latency (Resend webhook received → message visible in `/emails/[id]`).
- API error rate by route, by org.
