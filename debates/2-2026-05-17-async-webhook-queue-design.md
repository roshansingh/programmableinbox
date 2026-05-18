# Debate: Async Webhook Message Processing Queue

**Created:** 2026-05-17  
**Agent 1 (Initiator):** Claude  
**Agent 2:** TBD  
**Agent 3:** TBD  
**Max Rounds:** 3  
**Status:** OPEN

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

## Recommendation (A1)

**BullMQ** is the best choice because:

1. **Reliability**: Guaranteed processing with persistent job storage in Redis
2. **Simplicity**: Well-documented, standard patterns, no custom queue logic
3. **Production-ready**: Handles edge cases (retries, timeouts, dead-letter queues)
4. **Developer experience**: Clear semantics, easy to add job monitoring later
5. **Scalability**: Supports multiple workers without code changes

The database queue approach would require significant custom code for retries, backoff, and idempotency that BullMQ provides out-of-the-box.

---

## Plan

PLAN_STATUS: PENDING

{To be populated after debate converges}

---

## Parking Lot

- How to handle job uniqueness/deduplication (Resend duplicate prevention via externalId already exists)
- Should we add job monitoring UI (Bull Board) in staging/prod?
- How many workers should process webhook jobs?

---

## Dispute Log

| Round | Agent | Section | What Changed | Why | Status |
|-------|-------|---------|--------------|-----|--------|
| | | | | | |

**Status values:** `OPEN` = unresolved, needs further debate. `CLOSED` = all agents agree (accepted, conceded, or resolved). `PARKED` = deferred, not blocking convergence.
