# Async Webhook Processing Architecture

> Part of the [architecture docs](README.md). See also
> [email-ingestion-and-search.md](email-ingestion-and-search.md) for the ingestion path this
> plugs into.

## Overview

ProgrammableInbox supports **asynchronous email ingestion** to decouple Resend webhook reception from database storage and automation dispatch. This document covers the system design, components, and data flow.

**Design goal**: Return webhook response in 50-100ms without blocking on database or external service latency.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Resend                                                      │
│ POST /api/webhooks/email                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Webhook Route Handler                                       │
│ ├─ Validate HMAC signature + timestamp                     │
│ ├─ Fetch email from Resend API                            │
│ ├─ Determine matching inboxes (recipient address lookup)   │
│ └─ Branch on ENABLE_ASYNC_WEBHOOK_PROCESSING flag         │
└──────────────┬──────────────────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
    ASYNC PATH    SYNC PATH
    (Redis)       (Database)
        │             │
        ▼             ▼
   Enqueue Job   Store Email
   in Redis        Dispatch
   Return 200      Automations
                   Return Result

    ┌──────────────────────────┐
    │ Redis Stream             │
    │ (email-webhook-jobs)     │
    └──────────────┬───────────┘
                   │
                   ▼
    ┌──────────────────────────┐
    │ Worker Process           │
    │ (Next.js instance)       │
    │ ├─ Poll queue            │
    │ ├─ Idempotency check     │
    │ ├─ Store email           │
    │ ├─ Dispatch automations  │
    │ └─ Mark job complete     │
    └──────────┬───────────────┘
               │
         ┌─────┴─────┐
         │           │
         ▼ (success) ▼ (failure after max retries)
    PostgreSQL   Dead-Letter Queue
    (emails)     (email_job_dead_letter)
```

---

## Key Components

### 1. Webhook Route Handler

**Location**: `app/api/webhooks/email/route.ts`

**Responsibilities**:
- Validate HMAC signature (`x-webhook-signature`, `x-webhook-timestamp`) against `WEBHOOK_SECRET`
- Check timestamp is within 5-minute window (replay attack prevention)
- Fetch email data from Resend API using `event.data.email_id`
- Determine which inboxes match the recipient address list
- **Branch on async flag**:
  - **Async enabled**: Enqueue one job per matching inbox, return 200 immediately
  - **Async disabled**: Process synchronously in-request (old behavior)

**Key function**: `isAsyncWebhookProcessingEnabled()` checks `ENABLE_ASYNC_WEBHOOK_PROCESSING=true`

**Error handling**:
- Invalid signature → 401 (Resend retries)
- No matching inboxes → 200 (email ignored, no retry needed)
- Async mode, enqueue fails → 500 (Resend retries, force sync fallback)
- Async mode, signature validation fails → 401 (no job queued)

### 2. Job Queue (Redis Stream)

**Store**: Redis stream named `email-webhook-jobs`

**Job format**:
```json
{
  "externalId": "em_abc123",
  "inboxEmailAddressId": "inbox_def456",
  "payload": { ... ResendEmailData ... }
}
```

**Key features**:
- **Consumer group**: `email-webhook-worker` (single consumer, FIFO)
- **Persistence**: Ephemeral (jobs cleared on Redis restart, emails re-ingested by Resend)
- **Ordering**: FIFO globally; no per-inbox ordering guarantee (BullMQ open-source limitation)
- **Retention**: Auto-acknowledged on job completion, never persisted to disk

**Why Redis streams over queues**:
- Automatic dead-letter detection (jobs pending >timeout move to DLQ table)
- Atomic enqueue (job in Redis = job will be processed)
- Consumer group prevents duplicate processing across worker instances

### 3. Worker Process

**Runs in**: Same Next.js instance as webhook route (auto-started on first webhook or health check)

**Concurrency**: `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` parallel jobs (default: 5)

**Job processing pipeline**:

1. **Poll Redis**: Consume next job from `email-webhook-jobs` stream
2. **Idempotency check**: Does `EmailMessage` with this `externalId` already exist?
   - If yes → acknowledge job and skip processing (ignore duplicate webhook)
   - If no → proceed to storage
3. **Store email**: Call `storeIncomingEmail(resendEmail, [inboxId])`
   - Insert `EmailMessage` with unique constraint on `(externalId, inboxEmailAddressId)`
   - Insert any attachments
   - Return stored message object
4. **Dispatch automations**: Call `dispatchAutomationsForEmail(message.id)` to trigger any configured workflows
5. **On success**: Acknowledge job in Redis (removes from stream)
6. **On failure**: Move job to dead-letter table with error details (retries handled by task queue library)

**Retry logic** (built into BullMQ):
- Max retries: `WEBHOOK_QUEUE_MAX_RETRIES` (default: 3)
- Total attempts: 1 initial + N retries = 4 with default
- Backoff: Exponential (1s, 2s, 4s, 8s, ...)
- After max retries exceeded: Move to `email_job_dead_letter` table

### 4. Dead-Letter Queue (Database Table)

**Table**: `email_job_dead_letter`

**Schema**:
```sql
CREATE TABLE email_job_dead_letter (
  id UUID PRIMARY KEY,
  externalId TEXT NOT NULL,
  inboxEmailAddressId UUID NOT NULL,
  payload JSONB,
  error TEXT,
  attempt INT,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);
```

**Purpose**: Capture jobs that exceed max retries for investigation and manual recovery

**Monitoring**: Query for high error rates to detect systemic issues (DB connectivity, missing automations, corrupt payloads)

**Recovery**: Operators can investigate error pattern, fix root cause, then manually delete the dead-letter record and re-trigger via Resend dashboard

---

## Data Flow: Sync vs Async

### Sync Mode (ENABLE_ASYNC_WEBHOOK_PROCESSING=false)

```
Request arrives
    ↓
Validate signature
    ↓
Fetch from Resend
    ↓
Store in PostgreSQL (blocking)
    ↓
Dispatch automations (blocking)
    ↓
Return response

Timeline: ~500ms-2s (DB + API latency)
Failure: 500 response, Resend retries
```

**Use when**:
- Redis not available
- Low email volume (<10 emails/second)
- Automation latency is acceptable
- Simple deployments (single instance)

### Async Mode (ENABLE_ASYNC_WEBHOOK_PROCESSING=true)

```
Request arrives
    ↓
Validate signature (fast, <1ms)
    ↓
Fetch from Resend (cached, <10ms)
    ↓
Enqueue to Redis (atomic, <5ms)
    ↓
Return 200 OK

[In background, worker processes]
    ↓
Poll Redis queue
    ↓
Check idempotency (externalId exists?)
    ↓
Store in PostgreSQL (async)
    ↓
Dispatch automations (async)
    ↓
Acknowledge job in Redis

Timeline for response: 50-100ms (Redis write only)
Timeline for job: 1-2s per job (DB + automations)
Failure: Job retried, eventually moved to DLQ if persistent
```

**Use when**:
- Redis available and monitored
- High email volume (>100 emails/second)
- Fast webhook response critical (Resend's retry threshold)
- Automation latency is acceptable (async)

---

## Reliability Guarantees

### Idempotency

**Problem**: Resend may send duplicate webhooks for the same email if webhook processing times out.

**Solution**: Unique constraint on `(externalId, inboxEmailAddressId)` in `EmailMessage` table.

**Behavior**:
- First webhook → email stored, automations dispatched
- Duplicate webhook → enqueued, processed, but `CREATE` fails with `P2002` (unique constraint violation)
- Handler silently skips duplicate (logs and continues)

**Result**: Email processed exactly once, multiple webhook calls are safe.

### Retry Policy

**On job failure** (exception during store or dispatch):

1. Job is held in Redis with retry count
2. BullMQ retries with exponential backoff
3. After `WEBHOOK_QUEUE_MAX_RETRIES` + 1 attempts → job moved to `email_job_dead_letter`
4. Operator investigates DLQ, fixes root cause, manually re-triggers

**Example** (MAX_RETRIES=3):
```
t=0s:   Attempt 1 (initial) fails → retry in 1s
t=1s:   Attempt 2 (retry 1) fails → retry in 2s
t=3s:   Attempt 3 (retry 2) fails → retry in 4s
t=7s:   Attempt 4 (retry 3) fails → move to DLQ
```

**Failures that trigger retries**:
- Database connection timeouts
- Resend API unavailable during automation dispatch
- Temporary network issues

**Failures that don't retry** (immediate DLQ):
- Signature validation fails (not retried, logged as 401)
- Malformed payload (JSON parse error)
- No matching inboxes (logged as 200, not retried)

---

## Scaling Considerations

### Single Instance (Default)

```
Resend Webhook
    ↓
Next.js (webhook route + worker in same instance)
    ├─ Webhook route: handles incoming requests
    └─ Worker: processes jobs on background thread
    ↓
Redis
PostgreSQL
```

**Scaling limit**: ~5-10 jobs/second per instance (default concurrency: 5)

**Bottleneck**: Worker CPU/memory, not Redis or webhook route

### Multiple Instances (Horizontal Scaling)

```
Load Balancer
    ├─ Next.js Instance 1 (webhook route + worker)
    ├─ Next.js Instance 2 (webhook route + worker)
    └─ Next.js Instance 3 (webhook route + worker)
           │
           ├─ Redis (single, shared)
           └─ PostgreSQL (single, shared)
```

**How it works**:
- Each instance runs its own worker
- Workers share the same Redis queue (BullMQ consumer group prevents duplicate processing)
- Jobs are distributed across workers via Redis consumer group
- **Total throughput**: (number of instances) × (concurrency per instance)

**Example**:
- 3 instances, concurrency=5 each → 15 parallel jobs
- With 1-2 seconds per job → 7-15 jobs/second total throughput

**Considerations**:
- Redis becomes the bottleneck at very high throughput (100+ jobs/second)
- Consider Redis cluster or managed service (AWS ElastiCache) for scale
- All instances must have access to same Redis and PostgreSQL

### Monitoring Under Load

**Key metrics**:
1. **Queue depth** (`XLEN email-webhook-jobs`):
   - 0-100: normal
   - 100-1000: backlog, monitor memory
   - >1000: worker can't keep up, increase concurrency or instances

2. **Dead-letter count**:
   - 0/hour: normal
   - <10/hour: acceptable
   - >10/hour: investigate failures, likely DB or automation issue

3. **Worker latency**:
   - Per-job: 1-2s (DB + automations)
   - Webhook response: 50-100ms (Redis only)

4. **Redis memory**:
   - ~50MB for queue
   - ~10MB per 1000 pending jobs
   - Monitor trend; if growing unbounded, jobs aren't draining

---

## Integration Points

### 1. Webhook Route → Job Enqueueing

**Function**: `enqueueEmailWebhookJob(job)` in `lib/webhooks/queue.ts`

**Input**:
```typescript
{
  externalId: string,           // Resend email ID
  inboxEmailAddressId: string,  // Target inbox
  payload: ResendEmailData      // Full email data
}
```

**Output**: Resolves when job is in Redis (or rejects if Redis is unavailable)

**Contract**: Returns 200 only if all enqueue operations succeed (atomic, all-or-nothing for multi-inbox emails)

### 2. Job Processing → Email Storage

**Function**: `storeIncomingEmail(resendEmail, [inboxId])` in `app/api/webhooks/email/route.ts`

**Input**: Resend email object, array of inbox IDs to filter by

**Output**: Array of stored `EmailMessage` records

**Error handling**: Catches `P2002` (duplicate key) and skips silently

**Threading logic**:
1. Match by `In-Reply-To` / `References` headers
2. Fallback: Match by normalized subject (stripped `Re:` prefixes) within inbox
3. Default: Create new thread with message's own ID

### 3. Job Processing → Automation Dispatch

**Function**: `dispatchAutomationsForEmail(messageId)` in `lib/automations/dispatcher.ts`

**Input**: Stored email message ID

**Output**: Dispatch results (or empty if no automations configured)

**Trigger point**: Called after email stored, so automations can query the database for the message

### 4. Worker → Background Thread

**Framework**: BullMQ with Redis streams

**Start**: Auto-started on first webhook or `/api/internal/webhook-worker/health` health check

**Graceful shutdown**: Next.js SIGTERM handler pauses workers, waits for in-flight jobs, closes Redis

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLE_ASYNC_WEBHOOK_PROCESSING` | `false` | Enable async mode (requires Redis) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `WEBHOOK_QUEUE_MAX_RETRIES` | `3` | Max retries before dead-letter |
| `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` | `5` | Parallel job processing |

---

## Failure Modes

| Scenario | Sync Mode | Async Mode |
|----------|-----------|-----------|
| **Redis unavailable** | N/A | Webhook returns 500, Resend retries |
| **Database unavailable** | Webhook returns 500 | Job retried with exponential backoff, eventually DLQ |
| **Resend API timeout** | Webhook returns 500 | Job retried, eventually DLQ (if timeout is consistent) |
| **Automation fails** | Webhook returns 500 | Job retried, eventually DLQ |
| **Duplicate webhook** | Stored twice (if timing allows) | Stored once via idempotency check |
| **Worker crashes** | N/A | Job remains in Redis, picked up by other worker or restarted instance |

---

## Testing

### Unit Tests

**Mock points**:
- Redis enqueue (mock `enqueueEmailWebhookJob`)
- Resend API fetch (mock `resend.emails.receiving.get`)
- Database operations (mock Prisma)

**Coverage**:
- Signature validation (valid, invalid, expired)
- Sync vs async path selection
- Multi-inbox fanout
- Idempotency (duplicate handling)

### Integration Tests

**Setup**: Start Redis, PostgreSQL, Next.js dev server

**Scenarios**:
1. Webhook → enqueued → processed → database verified
2. Duplicate webhook → idempotency check → no duplicate messages
3. Redis unavailable → webhook returns 500
4. Worker crashed → job remains in queue → other worker processes

---

## See Also

- **Operator Guide**: `docs/async-webhook-processing-operator-guide.md` (deployment, monitoring, troubleshooting)
- **README**: `README.md` (quick start, configuration)
- **Code**: `app/api/webhooks/email/route.ts` (webhook handler), `lib/webhooks/queue.ts` (enqueue)
