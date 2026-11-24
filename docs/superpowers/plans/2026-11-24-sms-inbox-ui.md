# SMS inbox UI on real data (#143) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline). Steps use checkbox syntax.

**Goal:** Replace the fake conversations on `app/phones/[id]/page.tsx` with real `PhoneMessage` data: threads per counterparty, a message view, and mark-read.

**Architecture:** Two new dashboard routes under `app/api/app/phoneInbox/[id]/messages` (`GET` threads or one thread's messages; `PATCH` marks a thread read), a service `lib/services/phone-message.ts`, an app serializer, a client in `lib/api/phones.api.ts`, and a rewritten page. Mirrors the email list/detail conventions (keyset cursor on `(createdAt, id)`, `OrgScope` reads, `MessageReadScope` for read state, hand-written serializer allowlist).

**Tech Stack:** Next.js 16, Prisma 7 (raw-SQL migrations), Vitest (ui + real-Postgres integration), MSW.

**Spec:** `docs/superpowers/specs/2026-11-04-sms-inbound-inbox-design.md` (build order item 4). Ticket: #143.

## Global Constraints

- Receive-only: no compose box, no send route.
- Raw SQL bypasses the soft-delete extension and `PhoneMessage` is not in `SOFT_DELETE_MODELS`, so every read writes `"deletedAt" IS NULL` by hand.
- Reads are `OrgScope`; marking read takes `MessageReadScope` (user principals only). Another organization's inbox is a 404.
- Serializer is an allowlist: no `organizationId`, `externalId`.
- Run `npm run test` and `npm run test:integration` before the PR.

## Rulings (mine; each is cheap to reverse)

- **Read state is thread-level in the UI.** The column is per message (`isRead`, inbox-wide, like email #138), but the only action is "opened this thread, mark it read". One `PATCH` with `{threadId, isRead}` does an `updateMany`. Per-message toggling can be added later without a migration.
- **No search box.** Phone messages have no search vector and the ticket does not ask for search. The fake page's input is removed rather than left dead.
- **No compose box.** The ticket allows it only if cheap; the product is receive-only (#144 closed). The page keeps the one-line receive-only note.
- **Unread count per thread is computed in SQL** next to `threadCount`, over non-deleted rows.
- **Existing rows default unread.** The few rows #142 can have produced are all new.
- **Inbox must be `active`/`pending`** (the existing `getPhoneInbox` LIVE filter) to list messages; a released number's messages are not browsable.

## Review Focus

- A soft-deleted message is never listed, counted or marked read.
- Marking a thread read in one organization never touches another's thread with the same `threadId` text (it embeds the inbox id, but the query must still bind `phoneInboxId`).
- Cursor pagination across threads with identical `createdAt` neither skips nor repeats.
- An unknown or other-organization inbox is 404 on both routes, with no message data.
- A sender that is a short code or alphanumeric renders (avatar initials, no phone formatting crash).
- A message with `mediaCount > 0` and an empty body renders something, not a blank bubble.

---

### Task 1: `isRead` column

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261124090000_phone_message_is_read/migration.sql`; Test `test/integration/phone-message-schema.integration.test.ts`.

- [ ] Test: a new `PhoneMessage` has `isRead === false`.
- [ ] Run; expect FAIL. Add `isRead Boolean @default(false)` and `ALTER TABLE "phone_messages" ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;`. `npx prisma generate`. Run; expect PASS. Commit.

### Task 2: Service, serializer, routes

**Files:** Create `lib/services/phone-message.ts`, `lib/serializers/app/phone-message.ts`, `app/api/app/phoneInbox/[id]/messages/route.ts`; Tests `test/integration/phone-message-routes.integration.test.ts`, `lib/serializers/app/__tests__/phone-message.test.ts`.

**Interfaces:**
- `listPhoneThreads(scope: OrgScope, inboxId, {limit, cursor}) → {threads: ThreadHead[], nextCursor, hasMore} | null`; `ThreadHead` = latest message row + `threadCount`, `unreadCount`.
- `listThreadMessages(scope, inboxId, threadId, {limit, cursor}) → {messages, nextCursor, hasMore} | null` (newest first after review; the page reverses for display).
- `markThreadRead(scope: MessageReadScope, inboxId, threadId, isRead) → {updated: number} | null`.
- `GET ...?threadId=&cursor=&limit=` returns `{ threads | messages, nextCursor, hasMore }`; `PATCH` body `{threadId: string, isRead: boolean}` returns `{ updated }`; invalid body 400.

- [ ] Write the integration tests (real Postgres, signed-in user cookie via existing helpers): threads newest first with `threadCount`/`unreadCount`; deleted rows excluded; cursor pages without gaps with equal `createdAt`; thread messages newest first; PATCH marks only that thread's messages in that inbox; other-organization inbox 404 on both; bad body 400; released inbox 404.
- [ ] Run; expect FAIL. Implement (raw SQL for the thread head query with `DISTINCT ON`, `::uuid` casts, epoch-ms cursor compare, hand-written `deletedAt IS NULL`). Run; expect PASS. Commit.

### Task 3: Client and page

**Files:** Modify `lib/api/phones.api.ts`, `app/phones/[id]/page.tsx`, `test/mocks/handlers.ts`; Test `app/phones/[id]/__tests__/page.test.tsx`.

**Interfaces:** `getPhoneThreads(inboxId, {cursor?, limit?})`, `getPhoneThreadMessages(inboxId, threadId, {cursor?, limit?})`, `setPhoneThreadRead(inboxId, threadId, isRead)`; types `PhoneMessage`, `PhoneThread`.

- [ ] Tests (MSW): shows the inbox's real number and thread list from the API; selecting a thread loads its messages (shown oldest at the top); opening an unread thread calls PATCH and clears its badge; load-more fetches the next page; empty inbox state; API error state with a toast; short-code sender renders; media-only message shows an attachment note; no compose input.
- [ ] Run; expect FAIL. Implement. Run; expect PASS. Commit.

### Task 4: Docs and full verification

- [ ] `CLAUDE.md`: short "Phone inbox UI (issue #143)" section (thread-level read, no search/compose, soft-delete by hand).
- [ ] `npm run test`, `npm run test:integration`, `npm run lint`, `npm run build`. Commit.
