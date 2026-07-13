# Design: Cursor Pagination for Inbox Messages (Hard Switch)

**Date:** 2026-07-13
**Branch:** `feat/messages-cursor-pagination`
**Status:** Approved design — pending implementation plan
**Related review finding:** F2 (missing `(inboxEmailAddressId, createdAt)` index / offset pagination) in `reports/prisma-schema-review-2026-07-12.md`; also removes the F3 grouped-view memory load.

## Problem

`GET /api/v1/emailInbox/[id]/messages` is the single endpoint serving **both** the public API (documented in `lib/openapi/email-inboxes.ts`) and the UI (`lib/api/emails.api.ts` → `app/emails/[id]/page.tsx`). It uses offset pagination (`skip`/`take`) whose cost grows with page depth, and its grouped (thread-list) mode loads **every** message in the inbox into Node memory to group by `threadId` in JavaScript (`messages/route.ts:50-73`). There is no composite index supporting the `WHERE inboxEmailAddressId ORDER BY createdAt` access pattern.

## Goals

- Replace offset pagination with **cursor-only** keyset pagination across all three modes (flat, `threadId`, `grouped`).
- **Hard switch**: remove `page`, `total`, and `limit` from the response body. Remove the `page` request param. No backward-compatible offset fallback.
- Move grouped-mode grouping from JavaScript into SQL so the endpoint stops loading the whole inbox into memory.
- Add the indexes that make these queries index-ordered range scans (the F2 fix).

## Non-Goals (out of scope)

- The denormalized `Thread` summary table (Option 3). Grouped mode stays O(threads-in-inbox) per page. The cursor contract defined here is a strict subset of what a `Thread` table would expose, so a later migration to it requires **no API or client change**.
- New filters (starred / categories / tags / full-text search).
- Changes to any other endpoint.

## API Contract

### Request parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | int | 50 | Hard cap 100; values above are clamped |
| `cursor` | string | — | Opaque. Absent = first page |
| `threadId` | string | — | Single-thread mode |
| `grouped` | `"true"` | — | Thread-list mode (one row per thread). Ignored if `threadId` is present |

`page` is removed.

### Response body

Uniform across all three modes, wrapped by `jsonSuccess` (client unwraps `data`):

```jsonc
{
  "data": {
    "messages": [ /* EmailMessage[] ; grouped rows also carry threadCount */ ],
    "nextCursor": "b64url…" | null,
    "hasMore": true
  }
}
```

`total`, `page`, and `limit` are removed from the body.

### Cursor

- Opaque token: `base64url("<createdAt epoch milliseconds>|<id>")`. Epoch ms (not ISO) keeps the raw-SQL keyset comparison timezone-independent against the `timestamp(3)` column.
- Keyed on the tuple `(createdAt, id)`. `createdAt` is `timestamp(3)` and **not unique**, so `id` is the deterministic tiebreak that prevents skipped/duplicated rows across pages.
- A malformed / undecodable `cursor` returns **HTTP 400** `jsonError('Invalid cursor', 400)` — it is not silently treated as the first page.

## Query Implementation (per mode)

`hasMore` is computed by over-fetching: `take: limit + 1`; if more rows come back than `limit`, `hasMore = true`, the extra row is trimmed, and `nextCursor = encode(last kept row)`. Otherwise `nextCursor = null`.

### Flat mode (no `threadId`, no `grouped`) — newest first

```
WHERE inboxEmailAddressId = ?
  AND (createdAt, id) < (curCreatedAt, curId)   -- omitted on first page
ORDER BY createdAt DESC, id DESC
LIMIT limit + 1
```

Expressed in Prisma with an explicit keyset `where` (an `OR` of `createdAt < cur` and `createdAt = cur AND id < curId`) rather than Prisma's built-in `cursor`/`skip:1`, because the sort key (`createdAt`) is non-unique and the built-in cursor form is awkward and error-prone there.

### Thread mode (`threadId=X`) — oldest first

Same keyset technique, but `ORDER BY createdAt ASC, id ASC` with `>` comparison, matching how a conversation is rendered. Same `{ messages, nextCursor, hasMore }` contract; the UI pages until `hasMore=false` to assemble the full thread.

### Grouped mode (`grouped=true`) — one row per thread, newest thread first

Raw SQL via `prisma.$queryRaw` (Prisma cannot express `DISTINCT ON`), isolated in one well-commented helper:

```sql
WITH heads AS (
  SELECT DISTINCT ON ("threadId") *,
         count(*) OVER (PARTITION BY "threadId")::int AS "threadCount"
  FROM email_messages
  WHERE "inboxEmailAddressId" = $1
  ORDER BY "threadId", "createdAt" DESC, "id" DESC
)
SELECT * FROM heads
WHERE ((extract(epoch from "createdAt") * 1000)::bigint, "id") < ($curEpochMs, $curId)  -- omitted on first page
ORDER BY "createdAt" DESC, "id" DESC
LIMIT $take;
```

Returns the latest message per thread plus `threadCount`. Row shape is hand-mapped to the `EmailMessage` type extended with `threadCount`. Note: DB **columns are camelCase** (only the table is snake_case via `@@map`), so raw SQL double-quotes the camelCase identifiers. The cursor comparison uses epoch milliseconds (`::bigint`) to stay timezone-independent against the `timestamp(3)` column.

## Schema & Migration

```prisma
model EmailMessage {
  // ...existing fields...
  @@index([inboxEmailAddressId, createdAt, id])            // flat + thread keyset
  @@index([inboxEmailAddressId, threadId, createdAt, id])  // grouped DISTINCT ON heads
  // REMOVE: @@index([inboxEmailAddressId])  (now a redundant leftmost prefix)
}
```

Column-order rationale: equality filter (`inboxEmailAddressId`) → sort/range column (`createdAt`) → tiebreak (`id`), so the keyset tuple comparison is a pure index range scan with no sort node and no offset skip — O(page) at any depth. For grouped, leading `threadId` after the inbox filter lets `DISTINCT ON (thread_id)` walk one entry per thread.

Migration authored **non-transactionally** using `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` so it does not take a long lock on the hot `email_messages` table. (Prisma wraps migrations in a transaction by default; this migration must opt out.)

## Client & UI Changes

- `lib/api/emails.api.ts`:
  - `getEmailMessages(inboxId, { cursor?, limit?, threadId?, grouped? })` (drop `page`).
  - `EmailMessagesResponse` → `{ messages: EmailMessage[]; nextCursor: string | null; hasMore: boolean }`.
  - Grouped rows carry an optional `threadCount: number`.
- `app/emails/[id]/page.tsx`:
  - Inbox list (grouped) consumes `nextCursor`/`hasMore` via "Load more" / infinite scroll instead of a single unbounded fetch.
  - Thread view loops on `nextCursor` until exhausted, then sorts chronologically (it already sorts client-side today).

## OpenAPI

`lib/openapi/email-inboxes.ts`: replace the `page`/`limit`/`total` documentation with `cursor`/`limit` request params and `nextCursor`/`hasMore` response fields; document `threadCount` on grouped rows and the 400 on invalid cursor.

## Testing

Unit tests mirror the existing `app/api/v1/emailInbox/[id]/messages/__tests__/route.test.ts` style (mocked `prisma`, mocked `resolveAuthContext`):

- First page and subsequent page via `nextCursor` return the correct rows.
- `hasMore` true/false and `nextCursor` null/non-null boundaries.
- Same-millisecond `createdAt` rows are ordered and paged deterministically by `id` (tiebreak).
- Invalid/garbage `cursor` → 400.
- Grouped mode returns one row per thread with correct `threadCount` (raw-query shape mapping asserted).
- All three existing auth paths (user JWT, API key with `messages:read`, cross-org / missing-scope rejections) still pass.

Then the full suite: `npm run test` must pass before opening a PR (per `CLAUDE.md`).

## Risks

- **Raw SQL for grouped mode** is the main new maintenance surface. Mitigation: isolate in a single documented helper with a dedicated test asserting the row mapping and `threadCount`.
- **Breaking API change** (hard switch): any external consumer relying on `page`/`total` breaks. Accepted per explicit decision; OpenAPI is updated so the new contract is documented.

## Rollout

1. Single non-transactional migration: `CREATE INDEX CONCURRENTLY` the two new composite indexes, then `DROP INDEX CONCURRENTLY` the redundant `email_messages_inboxEmailAddressId_idx` (safe to drop immediately — the new composite `[inboxEmailAddressId, createdAt, id]` is a superset that serves every query the single-column index did).
2. Deploy endpoint + client + UI (cursor-only) together, since the response contract changes.
