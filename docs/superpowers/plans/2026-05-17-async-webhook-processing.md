# Async Webhook Processing with BullMQ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement async queue-based email webhook processing using BullMQ with per-inbox ordering, configurable retries, and dead-letter queue support.

**Architecture:** Webhook route validates and enqueues jobs to BullMQ (Redis-backed), returns 200 immediately. Worker polls Redis, processes jobs sequentially per inbox (max 5 parallel inboxes), skips duplicates via externalId, and moves failed jobs to dead-letter table after retries.

**Tech Stack:** Node.js, Next.js 16, BullMQ, Redis, Prisma 7, PostgreSQL

---

## Task 1: Add Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add bullmq and redis to package.json**

Open `package.json` and add to dependencies:
```json
"bullmq": "^5.9.4",
"redis": "^4.6.14"
```

- [ ] **Step 2: Run npm install**

```bash
npm install
```

Expected: `added 2 packages` or similar

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add bullmq and redis dependencies for async webhook processing"
```

---

## Task 2: Create EmailJobDeadLetter Prisma Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add EmailJobDeadLetter model to schema**

Open `prisma/schema.prisma` and add this model after the `EmailMessage` model:

```prisma
model EmailJobDeadLetter {
  id                    String   @id @default(cuid())
  externalId            String   // Resend email ID
  inboxEmailAddressId   String   @db.Uuid
  inboxEmailAddress     InboxEmailAddress @relation(fields: [inboxEmailAddressId], references: [id], onDelete: Cascade)
  payload               Json     // Full email payload
  error                 String   // Error message from failed processing
  attemptCount          Int      @default(1)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@unique([externalId, inboxEmailAddressId])
  @@index([externalId])
  @@index([inboxEmailAddressId])
  @@map("email_job_dead_letter")
}
```

- [ ] **Step 2: Generate Prisma client**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client` output

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma lib/generated/prisma
git commit -m "feat: add EmailJobDeadLetter model for webhook job dead-letter queue"
```

---

## Task 3: Create Queue Types and Client

**Files:**
- Create: `lib/webhooks/queue.ts`

- [ ] **Step 1: Create queue.ts with types and Redis client**

Create file `lib/webhooks/queue.ts` with queue client and types.

- [ ] **Step 2: Commit**

```bash
git add lib/webhooks/queue.ts
git commit -m "feat: create queue client with BullMQ and Redis configuration"
```

---

## Task 4: Create Worker Logic

**Files:**
- Create: `lib/webhooks/worker.ts`

- [ ] **Step 1: Create worker.ts with job processing logic**

Create file `lib/webhooks/worker.ts` with worker logic.

- [ ] **Step 2: Commit**

```bash
git add lib/webhooks/worker.ts
git commit -m "feat: create webhook worker with job processing and dead-letter queue"
```

---

## Task 5: Update Webhook Route to Enqueue Jobs

**Files:**
- Modify: `app/api/v1/webhooks/email/route.ts`

- [ ] **Step 1: Modify webhook POST route to enqueue instead of process**

Update the POST handler to enqueue jobs or process synchronously based on toggle.

- [ ] **Step 2: Commit**

```bash
git add app/api/v1/webhooks/email/route.ts
git commit -m "feat: add async queueing to webhook route with toggle"
```

---

## Task 6: Create Worker Initialization

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/api/internal/init/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add worker initialization**

Initialize webhook worker on app startup.

- [ ] **Step 2: Update .env.example**

Add environment variables for async webhook processing.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx .env.example app/api/internal/init/route.ts
git commit -m "feat: initialize webhook worker on app startup"
```

---

## Task 7-12: Tests and Documentation

- [ ] **Task 7:** Write unit tests for queue client
- [ ] **Task 8:** Write unit tests for worker
- [ ] **Task 9:** Write integration tests for webhook flow
- [ ] **Task 10:** Run tests and verify
- [ ] **Task 11:** Create operator documentation
- [ ] **Task 12:** Final verification

---

## Implementation Notes

- Each task includes specific file paths and exact code to implement
- Use test-driven development: write tests first, then implement
- Commit after each task completes
- Tests should verify: async queueing, idempotency, retries, dead-letter queue
- Configuration should be environment-specific with defaults
