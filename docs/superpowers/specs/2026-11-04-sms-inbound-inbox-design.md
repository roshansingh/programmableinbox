# SMS inbound inbox (epic #139) — design

Date: 2026-11-04. Status: draft for approval.

## Intent

Let a user provision a real US/CA phone number and **receive** SMS in the dashboard, the v1 API and MCP — chiefly so OTP texts can be read by people and agents, as `pibx_email_get_latest_otp` already does for email. Receive-only is a product decision, not a deferral: we are not supporting 10DLC registration at all, only standard 10-digit long-code numbers with low daily limits, so outbound traffic is out of scope.

## Goals

- Real numbers bought from Twilio, owned by exactly one org at a time.
- Inbound SMS ingested via a signed Twilio webhook, threaded per counterparty, deduplicated.
- Paid-plan quota on received messages; self-hosted unlimited by construction.
- Dashboard UI on real data; read-only v1 API; read-only `pibx_sms_*` MCP tools.
- LLM enrichment (OTP extraction) with the same guardrails as email.

## Non-goals

- Sending in any form: no reply route, no `sms.sent` metric, no reply throttle, no `send_sms`/`forward_sms` automation blocks. (#144 closed as won't-do; compose box not built.)
- 10DLC / toll-free verification, non-US/CA numbers.
- MMS media storage (#145): MMS ingests its text/caption; media is dropped and the message records a media count. No attachment storage, no `ATTACHMENT_STORAGE_ENABLED`. Revisit only if asked.
- MCP write tools (create/update/delete phone inbox): numbers cost real money and a model can be prompt-injected.

## Anti-goals

- A number claimable by two orgs, or any inbox row created from client-supplied digits.
- Ingestion failing because of anything in the message (oversized body, media, odd encoding).
- Verifying the Twilio signature against a URL derived from `Host`.

## Constraints and decisions (my calls unless noted)

- **Hosted:** one platform Twilio account, no subaccounts. Subaccounts give a per-org auth token and force a lookup before signature verification.
- **Self-hosted:** operator sets Twilio credentials in env.
- **Config:** new `twilio` domain in `lib/config/schema.ts`. `SMS_ENABLED` (default false); `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (a `Secret`) required, and `APP_BASE_URL` also required, when it is true; asserted at boot; listed in `.env.example`. Names follow current repo conventions (`COMMERCIAL_ENABLED`, `EMAIL_LINK_SIGNING_SECRET`), not the older names in the tickets.
- **Webhook URL** is set per number at purchase (`SmsUrl`) from `APP_BASE_URL`, and signature verification uses the same configured origin, never `Host`/`X-Forwarded-Host`.
- **Scope model first.** `GET /api/app/phoneInbox` is filtered by `userId` today. Phones move to the `OrgScope` (see) / `OwnerScope` (change) model, with `isOwner` in the serializer, before the v1 API exists.
- **Uniqueness:** a unique index on `phoneNumber` that applies only while `status != 'released'` (raw-SQL partial index, with the Prisma `dbgenerated`/drift handling used for `searchVector`). A released number can legitimately be re-bought by another org.
- **Release on delete:** deleting an inbox releases the Twilio number immediately, with explicit confirmation in the UI. No grace period, no sweeper.
- **Plans:** both SaaS plans currently set `phoneInboxesEnabled: false`; enabling it and setting counts is part of provisioning. New `QuotaMetric`s: `sms.received`, `sms.dropped`. Added to the usage dashboard.
- **Enrichment quota:** SMS shares `llm.enrichments` (same provider cost).
- **Webhook responds fast:** return empty TwiML `<Response/>` with 200; never auto-reply.

## Build order (each: worktree, TDD, own PR, `npm run test` green)

1. **#140** Twilio config domain + lazy `getTwilio()` client (modelled on `lib/resend.ts`) + error mapping.
2. **#141** Provisioning: scope migration, `PhoneInbox` fields (`twilioSid`, `status`, `capabilities`, `releasedAt`), partial unique index, area-code search and purchase, release on delete, plan flags, new dialog and `phones.api.ts`.
3. **#142** Inbound: `PhoneMessage`, `app/api/webhooks/sms` (`withPublic`, `X-Twilio-Signature`, timing-safe compare), `(externalId, phoneInboxId)` dedupe with quota refund on `P2002`, threading by counterparty, `sms.received` consume / `sms.dropped` on over-quota. `extractedOtp` field only. Add to route-guards.
4. **#143** UI on real data and **#146** enrichment, in parallel.
5. **#148** v1 read-only routes + OpenAPI + serializers + `pibx_sms_*` read tools (update guard 1/8 allowlists). **Improvement (not in the ticket today): `GET /api/v1/phoneInbox/{id}/otp`**, mirroring `app/api/v1/emailInbox/[id]/otp/route.ts`. The ticket lists only the MCP `get_latest_otp` tool, so REST callers would have had no equivalent.
   - Same contract: `withinMinutes` (strict integer 1-1440, default 15), optional `from` filter only (no `q`/`tags`/`categories`), 404 with distinct "nothing arrived" vs "found but stale" messages, response `{ otp, message }`.
   - Shared lookup: extract a `findLatestOtp` for phones (scan last 25 messages for non-null `extractedOtp` inside the window) used by both the route and `pibx_sms_get_latest_otp`, as email does, so they cannot drift.
   - **Hard dependency on #146:** `extractedOtp` is only populated by enrichment, so build #146 before this, otherwise the route always 404s.
   - **API key scopes are unmentioned in every ticket.** New scopes needed, named by domain like the email ones: `sms_inboxes:read` and `sms_messages:read` (the OTP route takes `sms_messages:read`). Add to `API_KEY_SCOPE_SET`; do not widen `DEFAULT_API_KEY_SCOPES` by spread; the MCP per-tool `authorize` check needs them too.
6. **#147** automations: optional, decided last. If done, SMS-received trigger with existing email/webhook actions only. The one-graph-or-two-channels schema decision is made at the start of that issue.

## Left to the builder

Message body length cap and the SQL `left()` cap for the search vector (follow email), pagination and cursor shape (follow email), UI component structure (mirror the email list/detail), and exact Twilio error-code mapping.

## Open question for you

None blocking. Flag if you want MMS media stored after all; that reopens #145.
