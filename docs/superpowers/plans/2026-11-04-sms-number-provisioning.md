# SMS number provisioning (#141) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen by the user for this epic) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake "type any number" phone inbox flow with real Twilio provisioning: search US/CA inventory by area code, purchase, persist, and release on delete.

**Architecture:** A `reserve → purchase → activate` flow. A `pending` row is inserted first and claims the number through a partial unique index; Twilio is then called; the row becomes `active` (with `twilioSid`) or `failed`. Deletion releases at Twilio first, then soft-deletes. Phones move to the `OrgScope` (read) / `PhoneWriteScope` + `OwnerScope` (change) model with an `isOwner` serializer.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (raw-SQL migration), Twilio SDK via `callTwilio` (`lib/sms/twilio-client.ts`, merged in #187), Vitest (`node` + `ui` projects, real-Postgres integration suite).

**Spec:** `docs/superpowers/specs/2026-11-04-sms-inbound-inbox-design.md` (build-order item 2). Ticket: roshansingh/programmableinbox#141. Depends on #140 (merged).

## Global Constraints

- Receive-only. No sending, no MMS, no 10DLC. US and CA only; country is exactly `'US' | 'CA'`.
- `lib/config` is the only reader of `process.env`. Use `requireSms()` (`{ accountSid, authToken, appBaseUrl }`); it throws `ConfigError` naming `SMS_ENABLED` when off.
- Every Twilio call goes through `callTwilio(fn)`; handlers branch on `SmsProviderError.kind` (`auth | invalid-request | not-found | rate-limited | unavailable | unknown`), never on SDK error shapes.
- The webhook URL set on a purchased number is `${appBaseUrl without trailing slash}/api/webhooks/sms`, method `POST`. Never derived from `Host`.
- Numbers are stored E.164 (`^\+[1-9]\d{7,14}$`).
- Response envelope: `jsonSuccess` / `jsonError` / `jsonPlanDenial` from `lib/api-helpers.ts`.
- Raw SQL bypasses the soft-delete extension: any `$queryRaw` on phone inboxes writes `"deletedAt" IS NULL` by hand.
- TDD for every task; full `npm run test` before the PR; integration tests for anything touching the partial index or the provisioning flow (`npm run test:integration`).

## Rulings baked into this plan (my calls; each is a line in the PR description)

1. **Unique index covers `pending` and `active` only** (`WHERE status IN ('pending','active')`), not "everything but released" as the spec wrote. A `failed` row holds no number and must not block a retry.
2. **Existing rows are backfilled to `released`**, not deleted. They were typed in by hand, have no `twilioSid`, and the user confirmed none belong to real users. Non-destructive, and the list filters them out.
3. **`PATCH /api/app/phoneInbox/[id]` is removed.** A real number is immutable, and there is no other editable field. `updatePhoneInbox` is removed from the client with it.
4. **Plan enablement is the last task.** Pro gets `phoneInboxesEnabled: true, phoneInboxes: 2`; Free stays off. A one-row data change if the numbers are wrong.
5. **No `AppConfig` key** for SMS. A disabled deployment answers 503 with a corrective message that the dialog shows.

## Review Focus

- Two organizations (or two requests) buying the same number at once: exactly one wins, the other gets 409, and nobody is billed twice.
- Twilio purchase succeeds but the DB update to `active` fails: the number is released again (compensation) and the row ends `failed`, so no paid number is orphaned.
- Delete when Twilio already released the number (404): treated as success. Delete when Twilio is down: the row stays `active` and the call is retryable.
- A teammate can see an inbox they cannot delete; another organization's inbox is a 404 by id, never a 403.
- A released or failed number can be bought again; the pre-existing fake rows neither block nor appear.
- `APP_BASE_URL` with a trailing slash does not produce `//api/webhooks/sms`.

---

### Task 0: Setup

- [ ] **Step 1:** `npm install`, then `npm run test` and record the baseline test count in the ledger (expect 2790 passed, 2 skipped). Confirm `npm run test:integration` can run locally (needs `.env.test`); if it cannot, ledger a Ruling and still write the integration tests, running them in CI.

---

### Task 1: Schema, partial unique index, backfill

**Files:**
- Modify: `prisma/schema.prisma` (`PhoneInbox`)
- Create: `prisma/migrations/20261104120000_phone_inbox_provisioning/migration.sql`
- Test: `test/integration/phone-inbox-schema.integration.test.ts`

**Interfaces:**
- Produces: `PhoneInboxStatus` enum (`pending | active | released | failed`); `PhoneInbox.twilioSid String? @unique`, `status PhoneInboxStatus @default(pending)`, `capabilities Json?`, `releasedAt DateTime? @db.Timestamptz(3)`; DB index `phone_inboxes_phoneNumber_live_key` unique on `("phoneNumber") WHERE status IN ('pending','active')`.

- [ ] **Step 1: Write the failing integration tests.** (a) two `active` rows with the same `phoneNumber` → Prisma `P2002`; (b) a `pending` row and an `active` row, same number → `P2002`; (c) `released` + `active` same number → ok; (d) `failed` + `pending` same number → ok; (e) two rows with `twilioSid: null` → ok; (f) the soft-delete: a row with `deletedAt` set but `status: 'active'` still holds the number (deletion must go through `released`, not just `deletedAt`).
- [ ] **Step 2:** Run `npm run test:integration -- phone-inbox-schema`. Expected: FAIL (columns missing).
- [ ] **Step 3: Edit the schema and write the migration by hand** (enum, the four columns, `UPDATE "phone_inboxes" SET "status" = 'released', "releasedAt" = now() WHERE "twilioSid" IS NULL` for the backfill, then the partial unique index created *after* the backfill). Header-comment the migration the way `20260803233000_message_full_text_search` does.
- [ ] **Step 4:** Run `npx prisma migrate dev` against a scratch DB and confirm Prisma does not propose dropping the partial index. If it does, ledger a Ruling and add a short note to `CLAUDE.md` (Prisma-drift handling for this index), as was done for `searchVector`.
- [ ] **Step 5:** Run the integration tests. Expected: PASS. Commit `feat(sms): phone inbox status, twilioSid and live-number uniqueness`.

---

### Task 2: Scope model and serializer for phones

**Files:**
- Modify: `lib/services/scope.ts`; Create: `lib/services/phone-inbox.ts`, `lib/serializers/app/phone-inbox.ts`
- Test: `lib/services/__tests__/phone-inbox.test.ts`, extend `lib/services/__tests__/scope.test-d.ts`, `lib/serializers/app/__tests__/phone-inbox.test.ts` (match existing neighbours' locations)

**Interfaces:**
- Produces: `type PhoneWriteScope = { organizationId: string; userId: string; readonly __scope?: 'phoneWrite' }`; `toPhoneWriteScope(principal: UserPrincipal, organizationId: string): { scope: PhoneWriteScope; error?: never } | { scope?: never; error: Response }` (membership-checked; 403 `Not authorized for this organization`).
- `listPhoneInboxes(scope: OrgScope): Promise<PhoneInbox[]>` and `getPhoneInbox(scope: OrgScope, id: string): Promise<PhoneInbox | null>` — both filter `organizationId IN scope`, `status IN ('pending','active')`, order `createdAt desc, id desc`, `take: MAX_UNPAGINATED_ROWS`.
- `countLivePhoneInboxes(organizationId: string): Promise<number>` — `pending` + `active`, for `checkResourceLimit`.
- `serializeAppPhoneInbox(inbox, viewerUserId)` → `{ id, organizationId, phoneNumber, countryCode, status, capabilities, isOwner, createdAt, updatedAt }`; no `twilioSid`, no raw `userId`.

- [ ] **Step 1: Write failing tests:** the serializer's exact key set and `isOwner`; the service filters (other org excluded; `released`/`failed` excluded; ordering); `toPhoneWriteScope` denies a non-member; type tests that `PhoneWriteScope`, `OwnerScope`, and `InboxWriteScope` are mutually unassignable.
- [ ] **Step 2:** Run; Expected: FAIL. **Step 3:** Implement. **Step 4:** Run; Expected: PASS, plus `npx tsc --noEmit` shows no new errors beyond the 38 pre-existing in `schema.test.ts`. **Step 5:** Commit.

---

### Task 3: Twilio number operations

**Files:**
- Create: `lib/sms/numbers.ts`; Test: `lib/sms/__tests__/numbers.test.ts`

**Interfaces:**
- Consumes: `callTwilio`, `requireSms`.
- Produces:
  - `type SmsCountry = 'US' | 'CA'`
  - `type AvailableNumber = { phoneNumber: string; locality: string | null; region: string | null }`
  - `searchAvailableNumbers(country: SmsCountry, areaCode: string): Promise<AvailableNumber[]>` — `availablePhoneNumbers(country).local.list({ areaCode: Number(areaCode), smsEnabled: true, limit: 20 })`.
  - `type PurchasedNumber = { sid: string; phoneNumber: string; capabilities: { sms: boolean; mms: boolean; voice: boolean } }`
  - `purchaseNumber(phoneNumber: string): Promise<PurchasedNumber>` — `incomingPhoneNumbers.create({ phoneNumber, smsUrl, smsMethod: 'POST' })`, with `smsUrl = ${appBaseUrl.replace(/\/+$/, '')}/api/webhooks/sms`.
  - `releaseNumber(sid: string): Promise<void>` — `incomingPhoneNumbers(sid).remove()`; a `not-found` `SmsProviderError` resolves (already gone), anything else rethrows.

- [ ] **Step 1: Failing tests** (mock `@/lib/sms/twilio-client`'s `callTwilio` to invoke the callback with a fake client): area code reaches `list` as a number; results map to `AvailableNumber`; `smsUrl` has exactly one slash before `api` for both `https://x.test` and `https://x.test/`; `releaseNumber` swallows `not-found` and rethrows `unavailable`; `purchaseNumber` propagates `invalid-request`.
- [ ] **Step 2:** Run; Expected: FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

---

### Task 4: Provisioning service (reserve → purchase → activate, release)

**Files:**
- Create: `lib/services/phone-provisioning.ts`; Test: `test/integration/phone-provisioning.integration.test.ts` (real Postgres, `lib/sms/numbers` mocked)

**Interfaces:**
- Consumes: `PhoneWriteScope`, `OwnerScope`, `purchaseNumber`, `releaseNumber`, `SmsProviderError`.
- Produces:
  - `class NumberUnavailableError extends Error` (reservation collided, or Twilio `invalid-request` on purchase)
  - `provisionPhoneInbox(scope: PhoneWriteScope, input: { phoneNumber: string; countryCode: SmsCountry }): Promise<PhoneInbox>`
  - `releasePhoneInbox(scope: OwnerScope, id: string): Promise<'released' | 'not-found'>`

Behaviour of `provisionPhoneInbox`: validate E.164 (throw `RangeError`) → insert `pending` (P2002 → `NumberUnavailableError`) → `purchaseNumber` → update to `active` with `twilioSid`, `capabilities`. On purchase failure: set `failed`, rethrow (`invalid-request` becomes `NumberUnavailableError`). On failure of the activating update: call `releaseNumber(sid)` (log if that also fails), set `failed`, rethrow.
Behaviour of `releasePhoneInbox`: find owner-scoped `active` row (none → `'not-found'`) → `releaseNumber(twilioSid)` (a rethrow leaves the row untouched) → set `status: 'released', releasedAt, deletedAt` together.

- [ ] **Step 1: Failing integration tests:** happy path leaves one `active` row with `twilioSid`; two concurrent `provisionPhoneInbox` for one number → exactly one resolves and `purchaseNumber` is called once; purchase `invalid-request` → `NumberUnavailableError`, row `failed`, number re-buyable; purchase `unavailable` → row `failed`, error rethrown; activation failure (force by making the update throw) → `releaseNumber` called with the new sid and row `failed`; release happy path sets `released` + `deletedAt`; release when `releaseNumber` resolves for a vanished number still ends `released`; release when it throws → row still `active`; a different owner gets `'not-found'`.
- [ ] **Step 2:** Run; Expected: FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

---

### Task 5: Routes

**Files:**
- Modify: `app/api/app/phoneInbox/route.ts`, `app/api/app/phoneInbox/[id]/route.ts` (delete `PATCH`)
- Create: `app/api/app/phoneInbox/available/route.ts`
- Test: `test/integration/phone-inbox.integration.test.ts` (rewrite; seed via `status: 'active'`), unit tests for the new route; confirm `lib/__tests__/route-guards.test.ts` passes (the new route is `withUser`)

**Interfaces:**
- `GET /api/app/phoneInbox` — `toOrgScope(principal, ?organizationId)` → `listPhoneInboxes` → `serializeAppPhoneInbox`.
- `GET /api/app/phoneInbox/[id]` — `getPhoneInbox`; absent or other org → 404.
- `GET /api/app/phoneInbox/available?organizationId&country&areaCode` — checks, in order: 400 on bad `country` (not US/CA) or `areaCode` (not `^\d{3}$`) → `toOrgScope` → plan gate (402 via `jsonPlanDenial`, same as create) → `requireSms()` failure → 503 `SMS is not enabled on this deployment` → `searchAvailableNumbers`. Response `{ data: AvailableNumber[] }`.
- `POST /api/app/phoneInbox` body `{ organizationId, phoneNumber, countryCode }` — 400 on missing/invalid → `toPhoneWriteScope` → plan gate → `checkResourceLimit(… , () => countLivePhoneInboxes(organizationId))` → 503 if SMS off → `provisionPhoneInbox`. 201 + serialized row. `NumberUnavailableError` → 409 `That number is no longer available`; `SmsProviderError` of kind `rate-limited`/`unavailable` → 503 `Phone provider is unavailable, try again`; other kinds → 502 `Phone provider error` (details logged, never returned).
- `DELETE /api/app/phoneInbox/[id]` — `toOwnerScope` → `releasePhoneInbox`; `'not-found'` → 404; provider failure → 502/503 as above (row stays); success → 204.

- [ ] **Step 1: Failing integration tests** (one per bullet above, plus: a teammate gets the inbox in the list with `isOwner: false` and a 404 on `DELETE`; another org gets 404 on `GET [id]`; a `released` seeded row is absent from list and does not count against the plan limit; `PATCH` is no longer exported).
- [ ] **Step 2:** Run; Expected: FAIL. **Step 3:** Implement. **Step 4:** PASS, then the full `npm run test` and `npm run test:integration`. **Step 5:** Commit.

---

### Task 6: Client API and dialog

**Files:**
- Modify: `lib/api/phones.api.ts`, `components/create-phone-dialog.tsx`, `components/phones-list.tsx`, `test/mocks/handlers/phones.ts`, `test/mocks/fixtures/phones.ts`, `components/__tests__/phones-list.test.tsx`; remove the `updatePhoneInbox` usages
- Test: `components/__tests__/create-phone-dialog.test.tsx` (new)

**Interfaces:**
- `InboxPhone` gains `status`, `capabilities`, `isOwner`; `CreateInboxPhoneRequest = { organizationId; phoneNumber; countryCode: 'US' | 'CA' }`.
- `searchAvailablePhoneNumbers(params: { organizationId: string; country: 'US' | 'CA'; areaCode: string }): Promise<AvailablePhoneNumber[]>` → `GET /app/phoneInbox/available`.

- [ ] **Step 1: Failing component tests:** the dialog offers only US and CA; Search is disabled until the area code is exactly three digits; results render as a pick list; "Create" is disabled until one is chosen and sends the chosen E.164 number; a 409 shows the unavailable message and re-runs nothing silently; copy states that a real number is purchased and that deleting releases it permanently. In the list: delete shows a confirmation naming the number and that release is permanent; the delete action is hidden when `isOwner` is false.
- [ ] **Step 2:** Run (`--project ui`); Expected: FAIL. **Step 3:** Implement (reuse existing `Dialog`, `Select`, `Input` primitives; no free-text phone field remains). **Step 4:** PASS. **Step 5:** Commit.

---

### Task 7: Enable on paid plans, docs

**Files:**
- Create: `prisma/migrations/20261104130000_enable_phone_inboxes_pro/migration.sql` (read `20260808093000_use_commercial_plans` for the plan row shape; set `phoneInboxesEnabled: true, phoneInboxes: 2` on the paid plan only)
- Modify: `CLAUDE.md` (provisioning flow, the unique-index rule, release-on-delete, `PhoneWriteScope`), `.env.example` only if a variable changed (none expected)
- Test: an integration or unit assertion that the Free plan still resolves `phoneInboxesEnabled: false` and Pro resolves `true` with `phoneInboxes: 2`

- [ ] **Step 1:** Failing plan-resolution test. **Step 2:** Run; FAIL. **Step 3:** Write the migration and docs. **Step 4:** Run the full `npm run test`, `npm run test:integration`, `npm run lint`, `npm run build` (no SMS env) — all green. **Step 5:** Commit.
