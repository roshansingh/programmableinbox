# Async Webhook Processing with BullMQ — InboxUI Design Spec

**Date**: 2026-05-17  
**Status**: APPROVED  
**Scope**: Implement async queue-based processing for incoming email webhooks using BullMQ (Redis-backed) with per-inbox ordered processing, configurable retries, and dead-letter queue support.

---

## 1. Overview

Currently, the webhook endpoint (`POST /api/v1/webhooks/email`) processes email messages synchronously:
1. Validate signature
2. Fetch from Resend
3. Store in database
4. Dispatch automations
5. Return HTTP 200

This blocks the webhook response until all processing completes, risking timeout and webhook retries from Resend.

**Goal**: Decouple queueing from processing. Webhook validates and enqueues, returns 200 immediately. Workers process asynchronously with:
- Idempotent processing (via `externalId`)
- Per-inbox ordered message processing (same inbox stays sequential)
- Cross-inbox parallel processing (up to 5 inboxes concurrently)
- Configurable retry policy with dead-letter queue for failed jobs

---

## 2. Architecture

### Components

**A. Webhook Route** (`app/api/v1/webhooks/email/route.ts`)
- Validates HMAC signature (unchanged)
- Fetches email from Resend (unchanged)
- **NEW:** Enqueues job to BullMQ with `inboxId` as grouping key
- Returns HTTP 200 immediately (before processing)

**B. Redis + BullMQ Queue**
- Single Redis instance (in-process or networked)
- Queue name: `email-webhook-jobs`
- Job structure:
  ```json
  {
    "externalId": "resend-email-id",
    "inboxEmailAddressId": "inbox-email-address-id",
    "payload": { /* full email data */ }
  }
  ```
- Grouping: By `inboxEmailAddressId` to preserve inbox ordering
- Concurrency: Up to 5 inboxes processed in parallel; within each inbox, jobs execute sequentially
- Retries: `WEBHOOK_QUEUE_MAX_RETRIES` (env-configured, default 3)
- Backoff: Exponential (1s, 2s, 4s, ...)

**C. Worker** (same Next.js app)
- Runs as background process when `ENABLE_ASYNC_WEBHOOK_PROCESSING=true`
- Polls Redis for jobs grouped by inbox
- Per job: 
  1. Check idempotency (is `externalId` already in `EmailMessage`? skip if yes)
  2. Store incoming email via `storeIncomingEmail()`
  3. Dispatch automations via `dispatchAutomationsForEmail()`
  4. Mark job complete
- On failure: Retry up to `WEBHOOK_QUEUE_MAX_RETRIES` times, then move to `EmailJobDeadLetter` table

**D. Dead-Letter Queue Table** (`EmailJobDeadLetter`)
- Schema:
  ```
  id (uuid, pk)
  externalId (string, indexed)
  inboxEmailAddressId (uuid, fk)
  payload (jsonb)
  error (text)
  attemptCount (int)
  createdAt (datetime)
  updatedAt (datetime)
  ```
- Used for manual inspection and retry

---

## 3. Configuration

### Environment Variables

```bash
# Enable/disable async webhook processing
ENABLE_ASYNC_WEBHOOK_PROCESSING=true

# Redis connection
REDIS_URL=redis://localhost:6379

# Worker configuration
WEBHOOK_QUEUE_MAX_RETRIES=3
WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=5
```

Per environment:
- **dev**: `WEBHOOK_QUEUE_MAX_RETRIES=3`
- **staging**: `WEBHOOK_QUEUE_MAX_RETRIES=5`
- **prod**: `WEBHOOK_QUEUE_MAX_RETRIES=5`

---

## 4. Data Flow

### Synchronous Webhook Reception

```
POST /api/v1/webhooks/email
  ↓
Validate signature (HMAC)
  ↓
Fetch email from Resend
  ↓
Enqueue job { externalId, inboxEmailAddressId, payload } to BullMQ
  ↓
Return HTTP 200 (immediate, ~50-100ms)
```

### Asynchronous Processing (Worker)

```
Worker polling Redis
  ↓
Fetch job grouped by inboxEmailAddressId
  ↓
Check idempotency: is externalId in EmailMessage?
  ├─ Yes → Skip, mark complete
  └─ No → Continue
  ↓
storeIncomingEmail(payload) → create EmailMessage
  ↓
dispatchAutomationsForEmail(messageId)
  ↓
Success → Mark job complete, remove from queue
  ↓
Failure (exception) → Retry with exponential backoff
  ├─ Retries exhausted → Move to EmailJobDeadLetter table
```

---

## 5. Idempotency

**Mechanism**: Email messages have unique constraint on `(externalId, inboxEmailAddressId)`.

**Processing:**
1. Worker checks if message with `externalId` + `inboxEmailAddressId` exists
2. If exists: Skip processing, mark job complete
3. If not exists: Process normally

**Result**: Even if a job is retried multiple times or the same webhook is received twice, only one `EmailMessage` is created per unique email.

---

## 6. Failure Handling

### Retry Logic
- Max retries: `WEBHOOK_QUEUE_MAX_RETRIES` (configurable per env)
- Backoff: Exponential (1s, 2s, 4s, 8s, ...)
- After max retries: Move to `EmailJobDeadLetter` table

### Dead-Letter Queue
- Operators inspect failed jobs via SQL or UI
- Manual retry: Update `status` to `pending` and re-enqueue, or use a `/api/admin/webhook-jobs/[id]/retry` endpoint

### Error Logging
- Log all exceptions during processing (Resend fetch, database write, automation dispatch)
- Include `externalId`, `inboxId`, attempt number, error message
- Link to dead-letter table entry for debugging

---

## 7. Backward Compatibility

**Synchronous Mode** (when `ENABLE_ASYNC_WEBHOOK_PROCESSING=false`):
- Webhook route uses current behavior (no queueing)
- No worker starts
- No Redis required

**Async Mode** (when `ENABLE_ASYNC_WEBHOOK_PROCESSING=true`):
- Webhook queues, returns 200 immediately
- Worker processes asynchronously
- Redis required

---

## 8. Testing

### Unit Tests
- Webhook route enqueues job correctly
- Worker processes job and creates `EmailMessage`
- Idempotency check skips duplicates
- Retry logic exhausts and moves to DLQ
- Toggle between sync and async modes

### Integration Tests
- End-to-end: webhook → queue → worker → database
- Dead-letter queue population on failure
- Manual retry from DLQ

### Load Testing
- Measure throughput: jobs/second with `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=5`
- Per-inbox ordering (verify sequential processing within inbox)
- Redis memory usage, connection stability

---

## 9. Deployment Notes

### Redis Setup
- Single instance (local development or networked)
- No persistence required (ephemeral queue; jobs can be lost on restart, re-delivery via Resend webhook retry)
- Monitor Redis memory and connections

### Worker Process
- Runs as part of the main Next.js app
- Graceful shutdown: finish in-flight jobs before exiting
- Health check: expose `/api/health/webhook-worker` to verify worker is alive

### Monitoring
- Log job start, completion, retry, and DLQ moves
- Track queue depth (jobs waiting)
- Alert on DLQ growth or retry exhaustion

---

## 10. Success Criteria

- All webhook messages are processed (no loss due to synchronous timeout)
- Messages within the same inbox stay ordered
- Idempotent processing (no duplicate `EmailMessage` records)
- Configurable retries per environment
- Dead-letter queue for manual inspection and retry
- Environment toggle works (sync and async modes both functional)
- Tests pass (unit, integration, load)

---

## 11. Files to Modify/Create

| File | Action | Why |
|------|--------|-----|
| `app/api/v1/webhooks/email/route.ts` | Modify | Add queueing logic, conditional based on toggle |
| `lib/webhooks/queue.ts` | Create | BullMQ queue client and job types |
| `lib/webhooks/worker.ts` | Create | Worker logic: poll, process, idempotency, DLQ |
| `prisma/schema.prisma` | Modify | Add `EmailJobDeadLetter` model |
| `app/api/cron/webhook-worker/route.ts` | Create | Health check / heartbeat endpoint |
| `.env.example` | Modify | Add `ENABLE_ASYNC_WEBHOOK_PROCESSING`, `REDIS_URL`, etc. |
| `package.json` | Modify | Add `bullmq`, `redis` dependencies |

---

## 12. Out of Scope

- Redis cluster or high-availability setup (single instance only)
- Job monitoring UI (Bull Board) — can be added later
- Webhook signature re-validation in worker
- Custom job priority or scheduling
