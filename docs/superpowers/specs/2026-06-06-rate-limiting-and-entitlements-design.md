# Rate Limiting & Entitlements Design

**Date**: 2026-06-06  
**Status**: Draft  
**Issue**: #9 - Build per-organization rate limit feature

## Overview

InboxUI is being released as an open-source, self-hostable application. This design implements the foundational infrastructure for resource entitlements (API keys, inboxes) and usage-based rate limiting (emails/SMS processed per month), but enforcement is **disabled by default** for the open-source release.

When the SaaS offering launches, flipping `ENABLE_BILLING=true` activates all limits immediately, with no code changes required.

## Goals

1. Implement per-organization entitlements for:
   - Maximum API keys
   - Maximum email inboxes
   - Maximum SMS inboxes

2. Implement per-organization usage tracking for:
   - Emails processed per calendar month
   - SMS processed per calendar month

3. Keep open-source release lightweight:
   - No Redis dependency required (Redis only for SaaS)
   - No enforcement overhead when disabled
   - Single "free" plan (unlimited)

4. Future-proof for SaaS billing:
   - Plan model supports multiple tiers (hobby, pro, etc.)
   - Billing cycle tracking per-organization
   - Clean switch: set `ENABLE_BILLING=true` and add plans

## Architecture

### Enforcement Strategy: Hybrid

- **Middleware**: Global checks for API request rate limiting (future, not in scope)
- **Route Handlers**: Per-resource entitlement checks before creation
- **Background/Webhooks**: Usage tracking when emails/SMS are processed
- **Redis**: Distributed usage tracking (only when billing enabled)

### Key Design Principles

1. **Fail-open for open-source**: When `ENABLE_BILLING=false`, skip all checks and Redis calls
2. **Explicit over implicit**: Entitlement checks happen at point of creation, not middleware
3. **Optional dependencies**: Redis only required when `ENABLE_BILLING=true`
4. **Graceful degradation**: Advisory headers warn before hard limits

## Data Model

### New Tables

```prisma
model Plan {
  id                  String   @id @default(cuid())
  name                String   @unique  // "free", "hobby", "pro"
  description         String?
  maxApiKeys          Int      // -1 = unlimited
  maxEmailInboxes     Int
  maxPhoneInboxes     Int
  emailsMonthly       Int      // -1 = unlimited
  smsMonthly          Int
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  organizations       Organization[]
  @@map("plans")
}

model BillingCycle {
  id                  String   @id @default(cuid())
  organizationId      String   @unique
  startDate           DateTime  // Org's personal billing cycle start (sign-up date)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@map("billing_cycles")
}
```

### Updated Organization Model

```prisma
model Organization {
  // ... existing fields ...
  
  planId              String?
  plan                Plan?     @relation(fields: [planId], references: [id])
  billingCycle        BillingCycle?
  
  // ... existing relations ...
}
```

**Assumptions**:
- Every organization is assigned the "free" plan on creation
- BillingCycle.startDate defaults to org creation date (can be updated on trial conversion)
- Plan limit of `-1` means unlimited

## Implementation Details

### 1. Entitlement Checks

**Location**: `lib/entitlements.ts`

```typescript
export async function checkEntitlement(
  organizationId: string,
  resource: 'apiKey' | 'emailInbox' | 'phoneInbox'
): Promise<{ allowed: boolean; reason?: string }>
```

**Behavior**:
- If `ENABLE_BILLING=false`: always return `{ allowed: true }`
- If `ENABLE_BILLING=true`: count existing resources, compare to plan limit
- If plan limit is `-1`: unlimited, return `{ allowed: true }`

**Integration**: Call before creating API keys, email inboxes, or phone inboxes in route handlers.

```typescript
// app/api/v1/apiKeys/route.ts (POST)
const entitlement = await checkEntitlement(organizationId, 'apiKey')
if (!entitlement.allowed) {
  return jsonError(entitlement.reason, 429)
}
// ... rest of creation logic
```

### 2. Usage Tracking (Redis)

**Location**: `lib/usage.ts`

```typescript
export async function trackUsage(
  organizationId: string,
  type: 'email' | 'sms',
  quantity: number = 1
): Promise<void>

export async function getUsage(
  organizationId: string,
  type: 'email' | 'sms'
): Promise<number>

export async function checkUsageLimit(
  organizationId: string,
  type: 'email' | 'sms'
): Promise<{ allowed: boolean; current: number; limit: number }>
```

**Redis Schema**:
```
usage:{organizationId}:{email|sms}:{YYYY-MM}
```

**Behavior**:
- `trackUsage()`: increments Redis key, sets TTL to end of billing cycle
  - If `ENABLE_BILLING=false`: no-op
  - If `ENABLE_BILLING=true` and no Redis: throw error
- `getBillingCycleWindow()`: calculates month based on `BillingCycle.startDate`
  - Example: org with startDate=2026-06-05
    - Current window: 2026-06-05 to 2026-07-04 → Redis key = `2026-06`
    - Next window: 2026-07-05 onwards → Redis key = `2026-07`

**Integration**: Call in email/SMS webhook handlers when processing incoming messages.

```typescript
// app/api/v1/webhooks/email/route.ts
await trackUsage(organizationId, 'email')

if (process.env.ENABLE_BILLING) {
  const usage = await checkUsageLimit(organizationId, 'email')
  if (!usage.allowed) {
    return jsonError('Monthly email processing limit reached', 429)
  }
}
```

### 3. Configuration

**Environment Variables** (add to `.env.example`):

```bash
# Billing & Rate Limiting
# Set to true to enforce plan limits (entitlements and usage quotas)
# Default: false (open-source release has no limits)
ENABLE_BILLING=false

# Redis connection (only required if ENABLE_BILLING=true)
# Format: redis://[username:password@]host[:port][/db]
REDIS_URL=redis://localhost:6379
```

**Startup Validation** (in `lib/instrumentation.ts` or similar):

```typescript
if (process.env.ENABLE_BILLING && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL required when ENABLE_BILLING=true')
}
```

### 4. Database Seeding

**Location**: `prisma/seed.ts`

Create the "free" plan and assign it to all organizations:

```typescript
const freePlan = await prisma.plan.upsert({
  where: { name: 'free' },
  update: {},
  create: {
    name: 'free',
    description: 'Open source self-hosted plan',
    maxApiKeys: -1,           // unlimited
    maxEmailInboxes: -1,
    maxPhoneInboxes: -1,
    emailsMonthly: -1,
    smsMonthly: -1
  }
})

// Assign free plan to orgs created before this migration
await prisma.organization.updateMany({
  where: { planId: null },
  data: { planId: freePlan.id }
})
```

### 5. Error Handling & Response Headers

**HTTP Status**:
- `429 Too Many Requests`: Both entitlement and usage limit violations

**Advisory Headers** (when approaching limits):

```
X-Usage-Current: 850
X-Usage-Limit: 1000
X-Usage-Percent: 85
X-Usage-Warning: Approaching monthly limit
```

Clients can monitor these headers and warn users at 80% utilization before hard rejection at 100%.

**Implementation**:

```typescript
if (process.env.ENABLE_BILLING && usage.limit > 0) {
  const percentUsed = (usage.current / usage.limit) * 100
  response.headers.set('X-Usage-Current', String(usage.current))
  response.headers.set('X-Usage-Limit', String(usage.limit))
  response.headers.set('X-Usage-Percent', String(Math.round(percentUsed)))
  
  if (percentUsed >= 80) {
    response.headers.set('X-Usage-Warning', 'Approaching monthly limit')
  }
}
```

## Future SaaS Offering

When launching SaaS with billing:

1. **Add new plans** to database or seed:
   ```typescript
   { name: 'hobby', maxApiKeys: 5, emailsMonthly: 10000, ... }
   { name: 'pro', maxApiKeys: 50, emailsMonthly: 100000, ... }
   ```

2. **Flip the flag**: Set `ENABLE_BILLING=true` in production `.env`

3. **Assign plans**: Update org.planId based on subscription tier via billing system

4. **No code changes**: All enforcement logic already in place

## Scope & Assumptions

**In Scope**:
- Entitlement enforcement for API keys, email inboxes, SMS inboxes
- Usage tracking for emails/SMS processed per month
- Multi-organization per-user billing cycle windows
- Redis-backed usage tracking with automatic TTL cleanup
- Global `ENABLE_BILLING` flag to gate all enforcement

**Out of Scope**:
- API request rate limiting (e.g., 1000 calls/hour) — future
- Middleware-based enforcement — future
- Subscription/billing UI — future SaaS implementation
- Monitoring/alerting dashboard — future
- Audit logs for limit violations — future (log to application logger for now)

**Assumptions**:
- Organizations always have a plan assigned (defaulting to "free")
- Billing cycle start date = org creation date (can be updated on trial conversion)
- Redis is available and reachable when `ENABLE_BILLING=true`
- Usage tracking is best-effort; Redis memory loss is acceptable (not persisted to DB)
- Monthly limits reset on the same day of month as billing cycle start

## Testing Strategy

1. **Unit tests** for `checkEntitlement()` and `getUsage()` helpers
2. **Integration tests** for route handlers with entitlement checks
3. **Feature flag tests**: verify behavior with `ENABLE_BILLING=true` and `false`
4. **Redis tests**: mock Redis for unit tests, use real Redis for integration tests

Tests should cover:
- Limit reached vs. not reached
- Unlimited plans (-1 limits)
- Billing window boundary conditions (month rollovers)
- Missing Redis when `ENABLE_BILLING=true` (should error)

## Files to Create/Modify

**New Files**:
- `lib/entitlements.ts` — entitlement check logic
- `lib/usage.ts` — usage tracking helpers
- `prisma/migrations/[timestamp]_add_plans_and_billing_cycles.sql` — schema migration
- `prisma/seed.ts` (update) — add plan seeding

**Modified Files**:
- `prisma/schema.prisma` — add Plan and BillingCycle models, update Organization
- `.env.example` — add `ENABLE_BILLING` and `REDIS_URL`
- `lib/instrumentation.ts` (or similar) — add Redis validation on startup
- `app/api/v1/apiKeys/route.ts` (POST) — add entitlement check
- `app/api/v1/emailInbox/route.ts` (POST) — add entitlement check
- `app/api/v1/phoneInbox/route.ts` (POST) — add entitlement check
- `app/api/v1/webhooks/email/route.ts` — add usage tracking
- `app/api/v1/webhooks/sms/route.ts` (if exists) — add usage tracking

## Success Criteria

- ✅ Open-source release works with `ENABLE_BILLING=false`, no Redis required
- ✅ SaaS mode can be activated by setting `ENABLE_BILLING=true` and adding plans
- ✅ All limit checks are explicit and testable
- ✅ Billing window respects org sign-up date
- ✅ Monthly usage resets automatically via Redis TTL
- ✅ Advisory headers help clients avoid hard limit rejections
