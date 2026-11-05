# SMS inbound webhook (#142) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline). Steps use checkbox syntax.

**Goal:** Receive Twilio inbound SMS on a signed webhook, store it as a `PhoneMessage` threaded per counterparty, deduplicated, metered against a plan quota.

**Architecture:** `POST /api/webhooks/sms` (`withPublic`) reads the raw form body, verifies `X-Twilio-Signature` against the *configured* URL (`APP_BASE_URL` + `/api/webhooks/sms`, never `Host`), normalizes the params, and hands them to `storeIncomingSms`. That service resolves the active inbox by `To`, consumes `sms.received` *before* the insert, inserts, and refunds on `P2002` or failure. The response is always empty TwiML `<Response/>`.

**Tech Stack:** Next.js 16, Prisma 7 (raw-SQL migrations), Vitest (unit + real-Postgres integration), Twilio SDK `validateRequest` (constant-time compare).

**Spec:** `docs/superpowers/specs/2026-11-04-sms-inbound-inbox-design.md` (build-order item 3). Ticket: #142.

## Global Constraints

- Receive-only. No reply, no auto-reply, no `direction` or `status` column (rulings below).
- Signature URL comes from `requireSms().appBaseUrl`, trailing slashes trimmed, same builder as `purchaseNumber`. Never `Host` / `X-Forwarded-Host`.
- Ingestion must not fail on message content: truncate an oversized body, strip NUL bytes (Postgres rejects `\u0000` in `text`), ignore media (store only a count), accept non-E.164 senders (OTPs arrive from short codes like `32665` and alphanumeric senders).
- `extractedOtp` is a nullable column only; extraction is #146.
- Quota semantics copy email: consume before insert, refund on duplicate or failed insert, `sms.dropped` incremented on denial. Self-hosted is unlimited by construction (empty limits).
- `lib/config` is the only `process.env` reader. Run `npm run test` and `npm run test:integration` before the PR.

## Rulings (mine; cost if wrong is a migration or one-row update)

- No `direction`/`status` columns: the product has one direction and #144 was closed. Adding them later is additive.
- `threadId` is the deterministic string `${phoneInboxId}:${from}`: no lookup, no race, unlike email's "first message id".
- Only `active` inboxes receive. A message to a `pending` number in the instant before activation is dropped (logged).
- A genuine store failure returns 500 (after refund) so Twilio may retry; unknown number, over-quota, duplicate and SMS-disabled-for-that-number return 200 so it does not.
- Pro gets `incomingSmsPerPeriod: 500`. Phone numbers cost money; this is a one-field update.

## Review Focus

- Body containing `\u0000`, emoji, 1600 chars, or empty (MMS with media only) is stored, never a 500.
- Sender that is a short code or alphanumeric string is stored and threaded.
- Same `MessageSid` delivered twice stores one row and consumes one quota unit.
- Signature computed for a different URL (e.g. attacker-controlled `Host`) is rejected.
- Request with a query string or extra params still verifies/fails closed correctly.

---

### Task 1: PhoneMessage model

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261105090000_phone_messages/migration.sql`; Test `test/integration/phone-message-schema.integration.test.ts`.

**Interfaces:** Produces model `PhoneMessage { id uuid, phoneInboxId, organizationId, from, to, body, mediaCount Int @default(0), externalId, threadId, extractedOtp String?, createdAt, deletedAt? }`, `@@unique([externalId, phoneInboxId])`, `@@index([phoneInboxId, createdAt])`, `@@index([threadId, createdAt])`, `@@map("phone_messages")`; relations from `PhoneInbox.messages` and `Organization`.

- [ ] Write the schema test: duplicate `(externalId, phoneInboxId)` rejected with P2002; same `externalId` on a different inbox allowed; deleting the inbox cascades messages.
- [ ] Run it; expect FAIL (model missing).
- [ ] Add the model and migration (hand-written SQL, matching prisma conventions for names).
- [ ] Run `npx prisma generate`; run the test; expect PASS. Check `prisma migrate diff` against a migrated scratch DB shows no drift.
- [ ] Commit.

### Task 2: Quota metrics and plan limit

**Files:** Modify `lib/commercial/interfaces.ts` (`QuotaMetric` += `'sms.received' | 'sms.dropped'`), `lib/commercial/plan-limits.ts` (`incomingSmsPerPeriod: count`), `ee/plans/quota.ts` (`LIMIT_KEY['sms.received']`); Create migration `20261105090100_sms_received_quota_pro/migration.sql`; Tests: `lib/commercial/__tests__/plan-limits.test.ts`, the ee quota test, `test/integration/phone-inbox-plans.integration.test.ts`.

**Interfaces:** Produces `sms.received` (limited) and `sms.dropped` (report-only, no limit key).

- [ ] Tests: plan-limits key list includes `incomingSmsPerPeriod`; quota consumes `sms.received` against it and denies past the limit; `sms.dropped` has no limit; Pro migration sets 500 and leaves other limits.
- [ ] Run; expect FAIL. Implement. Run; expect PASS. Commit.

### Task 3: Webhook helpers

**Files:** Create `lib/sms/webhook.ts`; Test `lib/sms/__tests__/webhook.test.ts`.

**Interfaces:**
- `webhookUrl(): string` (from `requireSms().appBaseUrl`; shared with `purchaseNumber` via an exported `smsWebhookUrl`).
- `verifyTwilioSignature(header: string | null, params: Record<string,string>): boolean` (false on missing header; uses SDK `validateRequest` with `requireSms().authToken.reveal()`).
- `parseInboundSms(params): { externalId, from, to, body, mediaCount } | null` (null when `MessageSid`, `From` or `To` missing/blank; body NUL-stripped and capped at 4000 chars; `NumMedia` parsed to a non-negative int, default 0).

- [ ] Tests (signature built with the SDK's own `getExpectedTwilioSignature`): valid passes; wrong token, wrong URL, tampered param, missing header fail. Parse: short-code and alphanumeric `From` kept; NUL stripped; 5000-char body capped; empty body ok; missing `MessageSid` → null; `NumMedia=abc` → 0.
- [ ] Run; expect FAIL. Implement. Run; expect PASS. Commit.

### Task 4: Ingest service

**Files:** Create `lib/services/phone-ingest.ts`; Test `test/integration/phone-ingest.integration.test.ts`.

**Interfaces:** `storeIncomingSms(msg: ParsedInboundSms): Promise<'stored' | 'duplicate' | 'dropped' | 'no-inbox'>`; throws on a real store failure (after refund).

- [ ] Tests (real Postgres, `CommercialProvider` per existing integration pattern): stores a row with `threadId` `${inbox}:${from}`; two messages from one sender share a thread, different senders do not; duplicate `externalId` → `duplicate`, one row, quota unit refunded; unknown `To` and `released`/`pending` inbox → `no-inbox`; over-quota `drop` plan → `dropped`, `sms.dropped` incremented, nothing stored; NUL/emoji/long body stored.
- [ ] Run; expect FAIL. Implement (resolve plan once, consume before insert, refund on P2002 and on other failure). Run; expect PASS. Commit.

### Task 5: Route

**Files:** Create `app/api/webhooks/sms/route.ts`; Test `test/integration/sms-webhook-route.integration.test.ts`; verify `lib/__tests__/route-guards.test.ts` guard 4 and 5 cover it.

**Interfaces:** `POST` returns `200` `text/xml` `<Response/>` on stored/duplicate/dropped/no-inbox; `401` on bad signature; `400` on unparseable params; `503` when SMS is disabled (`ConfigError`); `500` on store failure.

- [ ] Tests: signed request stores and answers empty TwiML with `Content-Type: text/xml`; bad/missing signature 401 and nothing stored; signature built against a different host rejected; SMS disabled 503; replay of the same `MessageSid` 200 with one row; store failure 500.
- [ ] Run; expect FAIL. Implement: read `request.text()`, `URLSearchParams` → record, verify, parse, store, respond. Run; expect PASS. Commit.

### Task 6: Usage surface and docs

**Files:** Modify `app/api/app/usage/route.ts`, `components/usage-banner.tsx` (labels for `sms.received`/`sms.dropped`), `CLAUDE.md` (new "Inbound SMS (issue #142)" section), `lib/sms/numbers.ts` comment ("the route lands in #142" → real).

- [ ] Update the usage route/banner tests first (metric listed and labelled); run FAIL; implement; run PASS.
- [ ] Full `npm run test`, `npm run test:integration`, `npm run lint`, `npm run build`. Commit.
