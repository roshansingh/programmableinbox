# Async Webhook Processing — Operator Guide

## Overview

The InboxUI webhook system processes incoming Resend emails asynchronously using BullMQ (Redis-backed job queue). This guide covers deployment, configuration, monitoring, and troubleshooting.

**Key benefits:**
- Fast webhook responses (50-100ms) prevent Resend retries
- Automatic retries with exponential backoff
- Dead-letter queue for failed jobs
- Graceful shutdown (in-flight jobs complete before exit)

---

## Architecture Quick Reference

```
Resend Webhook POST → Validate → Enqueue Job → Return 200
                         ↓
                      BullMQ Queue (Redis)
                         ↓
                    Worker Process
                    ├─ Idempotency check
                    ├─ Store email
                    ├─ Dispatch automations
                    └─ On failure: Retry → Dead-letter
```

---

## Deployment

### Prerequisites

- **Redis**: Single instance (in-process or networked)
  - No persistence required (ephemeral queue)
  - Memory: ~100MB for typical 10k queued jobs
  - Connection: Available from all Next.js instances

- **Node.js Runtime**: 18+

- **Environment Variables**: See Configuration section

### Environment Setup

Add to `.env` or deployment config:

```bash
# Enable async webhook processing (required)
ENABLE_ASYNC_WEBHOOK_PROCESSING=true

# Redis connection (required if async enabled)
REDIS_URL=redis://localhost:6379

# Retry configuration (optional, defaults shown)
WEBHOOK_QUEUE_MAX_RETRIES=3
WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=5
```

### Per-Environment Recommended Values

| Env | MAX_RETRIES | Notes |
|-----|-------------|-------|
| dev | 3 | Fast feedback on failures |
| staging | 5 | More lenient, test recovery paths |
| prod | 5 | Balance reliability and recovery |

### Worker Startup

The worker starts automatically on first webhook or first health check (`GET /api/internal/webhook-worker/health`). Ensure this endpoint is warm on deployment:

```bash
# Trigger worker initialization
curl http://localhost:4000/api/internal/webhook-worker/health
```

### Graceful Shutdown

The Next.js process automatically:
1. Stops accepting new jobs
2. Waits for in-flight jobs to complete (with timeout)
3. Closes Redis connections
4. Exits cleanly

No manual intervention required, but ensure your orchestration allows 30-60s shutdown grace period.

---

## Configuration

### Feature Flag: ENABLE_ASYNC_WEBHOOK_PROCESSING

Controls sync vs. async processing:

- **`true`** (default): Async enqueueing, fire-and-forget, requires Redis
- **`false`**: Synchronous processing (old behavior), no Redis needed

**Toggling**:
- Change requires Next.js restart
- No live hotswap available

### Retry Policy

#### WEBHOOK_QUEUE_MAX_RETRIES

Max retries before dead-letter (default: 3)

Behavior:
- Job gets `attempts = maxRetries + 1` total executions
- 1 initial attempt + N retries
- Default 3 → 1 initial + 3 retries = 4 total attempts
- Backoff: exponential (1s, 2s, 4s, 8s, ...)

Example timeline with MAX_RETRIES=3:
```
t=0:    Attempt 1 fails → retry in 1s
t=1:    Attempt 2 fails → retry in 2s
t=3:    Attempt 3 fails → retry in 4s
t=7:    Attempt 4 fails → move to dead-letter
t=7:    Job in dead-letter, stop retrying
```

#### WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX

Max parallel jobs (default: 5)

- Jobs process FIFO across all inboxes
- No per-inbox ordering guarantee (BullMQ open-source limitation)
- Tune based on worker CPU/memory and job processing time

**Sizing**: Start with 5; increase if CPU is low during peak load.

### Redis Connection

#### REDIS_URL

Format: `redis://[username:password@]host[:port][/db]`

Examples:
```bash
# Local development
REDIS_URL=redis://localhost:6379

# With password (production)
REDIS_URL=redis://:mypassword@redis.example.com:6379/0

# Redis cluster node (single node)
REDIS_URL=redis://redis-1.example.com:6379

# Managed Redis (e.g., AWS ElastiCache)
REDIS_URL=redis://redis-endpoint.abc123.ng.0001.use1.cache.amazonaws.com:6379
```

#### Connection Health

The worker auto-connects on first request; no pre-warm needed. If Redis is unavailable:
- **Sync mode** (flag=false): Returns 500, Resend retries
- **Async mode** (flag=true): Returns 200, email dropped (fire-and-forget loss)

---

## Monitoring

### Health Check Endpoint

```bash
curl http://localhost:4000/api/internal/webhook-worker/health
```

**Healthy response (200)**:
```json
{
  "status": "healthy",
  "worker": "running",
  "timestamp": "2026-05-18T12:34:56.000Z"
}
```

**Unhealthy response (503)**:
```json
{
  "status": "unhealthy",
  "worker": "paused",
  "error": "connection refused",
  "timestamp": "2026-05-18T12:34:56.000Z"
}
```

### Key Metrics to Monitor

#### Queue Depth

Jobs waiting in Redis:
```bash
redis-cli XLEN email-webhook-jobs
```

- Green: 0-100 (normal)
- Yellow: 100-1000 (backlog, monitor)
- Red: >1000 (worker overloaded or stopped)

#### Redis Memory

```bash
redis-cli INFO memory | grep used_memory_human
```

Safe limit: <500MB for typical deployments. If exceeding:
- Increase `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` to drain faster
- Or scale Redis vertically

#### Dead-Letter Queue Count

```sql
SELECT COUNT(*) FROM email_job_dead_letter WHERE createdAt > NOW() - INTERVAL 1 HOUR;
```

- Green: 0 (no failures)
- Yellow: <10/hour (acceptable)
- Red: >10/hour (investigate failures)

### Log Patterns

Look for in application logs:

**Normal**:
```
Job job_123 completed
Email em_456 processed successfully for inbox inbox_789
```

**Warnings**:
```
Failed to enqueue job for inbox inbox_789: connection refused
Job job_123 failed (attempt 1): Error message
```

**Errors**:
```
Moving email em_456 to dead-letter queue after 4 attempts
```

---

## Troubleshooting

### Symptom: Webhooks Return 500

**Sync mode** (ENABLE_ASYNC_WEBHOOK_PROCESSING=false):
- Indicates database or automation dispatch failure
- Check application logs for specific error
- Resend will retry

**Async mode** (ENABLE_ASYNC_WEBHOOK_PROCESSING=true):
- Signature or timestamp validation failed
- Check webhook secret matches Resend's setting
- Check server clock is in sync (±5 min tolerance)

### Symptom: Emails Not Processing

**Check queue depth**:
```bash
redis-cli XLEN email-webhook-jobs
```

If queue is empty and worker is running:
- Webhooks may not be arriving (check Resend event logs)
- Or flag is `false` (sync mode, check env var)

If queue has jobs:
- Worker may be paused/dead
- Check health endpoint: `curl .../api/internal/webhook-worker/health`
- Check Redis connectivity
- Check worker logs for errors

### Symptom: Dead-Letter Queue Growing

Queries growing → worker can't process jobs successfully

**Investigate**:
1. Check application logs for repeated error patterns
2. Query dead-letter table:
   ```sql
   SELECT externalId, error, COUNT(*) as count 
   FROM email_job_dead_letter 
   GROUP BY error 
   ORDER BY count DESC;
   ```
3. Common causes:
   - Database connectivity issues
   - Missing automation record
   - Corrupt email payload

**Recovery**:
```sql
-- Inspect a failed job
SELECT * FROM email_job_dead_letter 
WHERE externalId = 'em_example' 
ORDER BY createdAt DESC LIMIT 1;

-- Manual retry (after fixing root cause)
DELETE FROM email_job_dead_letter 
WHERE externalId = 'em_example';
-- Resend will retry automatically or you can re-send from Resend dashboard
```

### Symptom: Worker Not Starting

After restart, health check returns 503:

```bash
# Check Redis is reachable
redis-cli ping
# Expected: PONG

# Check env vars are set
echo $REDIS_URL
echo $ENABLE_ASYNC_WEBHOOK_PROCESSING

# Check Next.js logs
npm run start | grep -i worker
```

If Redis is down:
- In sync mode, webhooks still work (no async needed)
- In async mode, webhooks return 200 but emails are lost
- Fix Redis connectivity, then restart Next.js

### Symptom: Redis Memory Growing

Queue jobs not draining:

1. Check worker concurrency is >0:
   ```bash
   echo $WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX
   ```

2. Check worker is running:
   ```bash
   curl http://localhost:4000/api/internal/webhook-worker/health
   ```

3. Increase concurrency to drain faster:
   ```bash
   # Edit .env
   WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=20
   # Restart Next.js
   ```

4. Check for slow jobs (each job takes >10s):
   ```sql
   SELECT COUNT(*), email_job_dead_letter.error 
   FROM email_job_dead_letter 
   WHERE updatedAt > NOW() - INTERVAL 1 HOUR 
   GROUP BY error;
   ```

---

## Performance Tuning

### Baseline

With default config on modest hardware:
- Webhook response: 50-100ms
- Job processing: 1-2 jobs/second per worker
- Memory: ~50MB for queue + worker

### Optimization: High Throughput

If serving >100 webhooks/second:

1. **Increase concurrency**:
   ```bash
   WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX=20
   ```

2. **Increase Redis memory**:
   ```bash
   # Redis config
   maxmemory 1gb
   ```

3. **Scale horizontally** (if using managed Redis):
   - Add more Next.js instances (each runs a worker)
   - Workers share the same Redis queue
   - Distributes load across instances

### Optimization: Low Latency

If webhook response must be <20ms:

1. **Disable sync fallback** (no database check in enqueue path):
   ```bash
   ENABLE_ASYNC_WEBHOOK_PROCESSING=true
   # (already does this)
   ```

2. **Local Redis** (in-process):
   ```bash
   REDIS_URL=redis://localhost:6379
   # versus networked
   ```

3. **Monitor enqueue failure rate** (fire-and-forget is OK if Redis fails <1%):
   - Check logs for "Failed to enqueue"
   - Set up alert if rate > 1%

---

## Alerts & Runbooks

### Alert: Queue Depth > 1000

**Severity**: High (jobs backing up)

**Check**:
1. Is worker running? `curl .../api/internal/webhook-worker/health`
2. Is Redis responsive? `redis-cli ping`
3. Are jobs failing? Query dead-letter count

**Action**:
- Increase `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX`
- Or scale to additional Next.js instances
- Or check for slow database/automation operations

### Alert: Dead-Letter Count > 10/hour

**Severity**: Medium (emails failing processing)

**Check**:
1. Query top errors:
   ```sql
   SELECT error, COUNT(*) FROM email_job_dead_letter 
   WHERE createdAt > NOW() - INTERVAL 1 HOUR 
   GROUP BY error ORDER BY COUNT DESC;
   ```

**Action**:
- Fix root cause (DB connectivity, missing data, etc.)
- After fix, manually retry jobs:
  ```sql
  DELETE FROM email_job_dead_letter 
  WHERE createdAt > NOW() - INTERVAL 1 HOUR;
  ```
  (Resend will retry or re-send)

### Alert: Worker Health Check Returns 503

**Severity**: Critical (worker down, emails dropped in async mode)

**Check**:
1. Is Redis running? `redis-cli ping`
2. Are Next.js logs showing errors?
3. Restart worker: `curl .../api/internal/webhook-worker/health`

**Action**:
- Restart Next.js process
- If Redis is down, restore Redis first
- Verify health check succeeds before returning to normal

---

## Maintenance

### Regular Tasks

**Weekly**:
- Monitor queue depth (should be near 0)
- Monitor dead-letter count (should be near 0)

**Monthly**:
- Review application logs for "Failed to enqueue" errors
- Check Redis memory usage trend
- Verify graceful shutdown works (kill -TERM process, check shutdown time)

**Quarterly**:
- Load test: simulate 10x typical webhook rate, verify queue drains
- Disaster recovery: kill Redis, verify webhooks still work (sync mode fallback)
- Clean dead-letter table (if not auto-cleaned):
  ```sql
  DELETE FROM email_job_dead_letter WHERE createdAt < NOW() - INTERVAL 30 DAYS;
  ```

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review application logs (grep for "webhook" or "queue")
3. Query database tables: `email_job_dead_letter`, `email_message`
4. Check Redis status: `redis-cli INFO stats`

---

## Appendix: Configuration Reference

| Variable | Default | Min | Max | Impact |
|----------|---------|-----|-----|--------|
| `WEBHOOK_QUEUE_MAX_RETRIES` | 3 | 0 | 10 | Jobs abandon after N failures |
| `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` | 5 | 1 | 50 | Parallel jobs; higher = faster but uses more CPU |
| `ENABLE_ASYNC_WEBHOOK_PROCESSING` | true | — | — | If false, sync mode (requires DB on each request) |
| `REDIS_URL` | redis://localhost:6379 | — | — | Must be reachable from all Next.js instances |

