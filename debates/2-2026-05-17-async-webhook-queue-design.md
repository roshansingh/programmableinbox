# Debate: Async Webhook Message Processing Queue

**Created:** 2026-05-17  
**Agent 1 (Initiator):** Claude  
**Agent 2:** Codex  
**Agent 3:** TBD  
**Max Rounds:** 3  
**Status:** CONVERGED

## Context

We need to implement async processing for webhook messages to ensure all messages are reliably processed. Currently, webhook messages are processed synchronously. The new design should:
- Webhook endpoint receives, validates, and queues the message
- Process messages asynchronously
- Ensure no messages are lost
- Maintain reliability without cloud-based queues (on-premise only)

### Current State

- `app/api/v1/webhooks/email/route.ts` receives Resend email webhook events
- HMAC validation with `x-webhook-signature` and `x-webhook-timestamp` headers
- Threading logic in `determineThreading` function
- Direct database writes via Prisma

### Constraints

1. **No cloud-based queues** — must be self-hosted/on-prem
2. **Reliability** — no message loss; idempotency preferred
3. **Simplicity** — fits within existing Next.js app architecture
4. **Maintainability** — low operational overhead

### Candidate Solutions

1. **BullMQ** — Redis-based job queue, widely used, supports retries, delayed processing
2. **Database Queue Table** — Custom queue table with polling/worker, no external dependencies
3. **Other alternatives** — RabbitMQ, native Node.js event emitters, etc.

---

## Proposal

STATUS: OPEN

### Option 1: BullMQ + Redis

**Pros:**
- Battle-tested, mature ecosystem
- Built-in retry logic, exponential backoff, delayed processing
- Job monitoring UI available (Bull Board)
- Scales well, separates concerns cleanly
- Handles job dependencies and worker scaling

**Cons:**
- Requires Redis (new operational dependency)
- Additional infrastructure to run and maintain
- More complexity than needed for email processing

### Option 2: Database Queue Table

**Pros:**
- No new dependencies (uses existing Prisma + PostgreSQL)
- Simple to understand and debug
- Fits naturally into existing app structure
- Easy to inspect queue state via SQL
- Minimal operational overhead

**Cons:**
- Polling-based (less efficient than event-driven)
- Manual retry logic needed
- Single worker or custom scaling logic
- More boilerplate code

### Option 3: Custom Node.js Queue (In-Memory with Persistence)

**Pros:**
- No external dependencies
- Simple API
- Built-in retry/backoff

**Cons:**
- Loses queued items on app restart (unless persisted)
- Complex persistence layer adds back the overhead
- Not suitable for distributed/multi-instance deployments

---

## Recommendation (CONVERGED)

**Database Queue Table** (PostgreSQL-backed) is the chosen approach.

**Rationale (A2-R1 evidence, accepted by A1):**

1. [A2-R1] The inbound webhook path is synchronous today. `POST` in `app/api/v1/webhooks/email/route.ts:233-287` fetches the Resend payload, stores one `emailMessage` per matching inbox, then blocks on `await Promise.all(stored.map((message) => dispatchAutomationsForEmail(message.id)))` at `app/api/v1/webhooks/email/route.ts:279-280`. Actual behavior: the HTTP 200 is returned only after automation dispatch finishes. Expected async behavior: durable enqueue before response, then processing out of band.

2. [A2-R1] The test suite confirms that synchronous coupling. In `app/api/v1/webhooks/email/__tests__/route.test.ts:84-135`, one webhook fan-outs to two inbox writes and the test asserts `dispatchAutomationsForEmail` was called exactly 2 times before the route returns 200. Actual evidence: `messageCreateMock` called 2 times and `dispatchAutomationsForEmailMock` called 2 times in the same request path. That means latency grows with stored messages and automation work.

3. [A2-R1] The codebase already has PostgreSQL-backed state machines for async-ish work, but no Redis/BullMQ dependency. `package.json:12-65` contains `@prisma/client`, `@prisma/adapter-pg`, and no `bullmq`, `ioredis`, or `redis`. `prisma/schema.prisma:154-160` already defines `AutomationRunStatus` with `queued` and `running`, and `lib/automations/dispatcher.ts:128-143` plus `app/api/cron/sweep-stuck-runs/route.ts:5-16` already implement stale-run recovery against database state. That is direct evidence the existing operational model is Postgres + cron/sweeper, not a separate queue service.

[A2-R1] My counterproposal is a **database queue table** as the default recommendation.

- [A2-R1] Reliability: enqueue in the same database that already stores `email_messages`, so the durability boundary stays inside PostgreSQL instead of splitting "message persisted" and "job persisted" across Postgres + Redis. The route already writes to Postgres in `storeIncomingEmail` (`app/api/v1/webhooks/email/route.ts:144-230`); adding one more row in the same write path is the minimum architectural move.
- [A2-R1] Simplicity: one new table plus one worker loop is smaller than introducing Redis, BullMQ, connection management, deployment changes, and operational recovery playbooks. This repo already has one sweeper endpoint and run-status semantics; extending that pattern is less surface area than adding another durable subsystem.
- [A2-R1] Maintainability: operators can inspect queue state with SQL, reuse Prisma models, and reason about retries alongside existing app data.

[A2-R1] I also verified that the existing `WebhookEvent` table is not a clean drop-in queue for inbound email processing. `prisma/schema.prisma:187-199` defines `WebhookEvent` as `{ webhookId, event, payload, status, attempts, deliveredAt }` with no inbox id, no email message id, no lease/claimed timestamp, and no next-attempt timestamp. The routes using it are outbound-webhook admin features:
- [A2-R1] `app/api/webhooks/[id]/test/route.ts:20-38` creates a pending `webhookEvent` for a user-configured webhook test.
- [A2-R1] `app/api/webhooks/[id]/events/route.ts:21-39` lists those events for UI pagination.
- [A2-R1] `app/api/webhooks/[id]/events/[eventId]/retry/route.ts:25-31` resets status to `pending` and increments `attempts`.

[A2-R1] Because of that evidence, my recommended order is:

1. [A2-R1] Recommend a new Postgres-backed ingress queue table, not BullMQ.
2. [A2-R1] Park RabbitMQ and in-memory queues as unnecessary because the current repo has zero supporting infrastructure for them, and the user constraint explicitly prefers low operational overhead.
3. [A2-R1] Keep BullMQ as a future escalation path only if measured throughput, contention, or worker fan-out exceeds what a DB queue can sustain. No such measurements exist in this document yet.

---

## Plan

PLAN_STATUS: READY_FOR_PLANNING

**Next step:** Create detailed implementation plan with:
1. New `EmailQueueJob` table schema (message ID, status, attempts, next_retry, created_at, updated_at)
2. Webhook route changes: enqueue instead of dispatch directly
3. Worker/sweeper endpoint to poll and process queued jobs
4. Retry logic and dead-letter handling
5. Idempotency via externalId (already exists)

---

## Parking Lot

- How to handle job uniqueness/deduplication (Resend duplicate prevention via externalId already exists)
- Should we add job monitoring UI (Bull Board) in staging/prod?
- How many workers should process webhook jobs?

---

## Dispute Log

| Round | Agent | Section | What Changed | Why | Status |
|-------|-------|---------|--------------|-----|--------|
| 1 | A2 | Recommendation | Replaced unsupported BullMQ recommendation with a DB-queue counterproposal backed by route, schema, and dependency evidence. | Current document had no inline evidence for Redis/BullMQ necessity; repo evidence points to synchronous request processing on top of Postgres and an existing sweeper/status pattern. | CLOSED |
| 2 | A1 | Recommendation | Concede to A2's evidence and accept database queue table as primary recommendation. | A2 provided three concrete facts with file:line evidence: (1) webhook route synchronously awaits automation dispatch before HTTP 200, (2) tests confirm this coupling, (3) codebase has zero Redis/BullMQ dependency and already uses Postgres + sweeper pattern for async work. These facts directly contradict my BullMQ assumption and support staying within PostgreSQL. | CLOSED |

**Status values:** `OPEN` = unresolved, needs further debate. `CLOSED` = all agents agree (accepted, conceded, or resolved). `PARKED` = deferred, not blocking convergence.
