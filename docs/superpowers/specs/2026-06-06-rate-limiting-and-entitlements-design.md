# Rate Limiting & Entitlements Design

**Date**: 2026-06-06  
**Status**: Draft  
**Issue**: #9 - Build per-organization rate limit feature

## Overview

ProgrammableInbox will be released as an open-source, self-hostable application. This design implements three clean abstractions—**Policy**, **Entitlements**, and **Metering**—that define the commercial boundary between the OSS core and future SaaS billing.

The OSS core provides permissive implementations that allow everything. When the separate **billing app** is built later, it will provide SaaS implementations of these interfaces with actual enforcement. The OSS core never needs to know whether billing exists.

This ensures:
- ✅ OSS release has zero billing dependencies
- ✅ SaaS billing is a separate concern (separate app/codebase)
- ✅ Clean, testable interfaces for extension
- ✅ No technical debt in the OSS core

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

## Architecture: Policy / Entitlements / Metering

Three clean abstractions define the commercial boundary:

### 1. **Policy** — Is an action allowed?

Decides whether an operation is permitted. Used before creating/processing resources.

```typescript
interface IPolicy {
  check(request: PolicyCheckRequest): Promise<PolicyCheckResult>
}

interface PolicyCheckRequest {
  organizationId: string
  action: 'email.process' | 'sms.process' | 'apiKey.create' | 'emailInbox.create' | 'phoneInbox.create'
  quantity?: number  // for rate-limit checks (e.g., "create 5 API keys")
}

interface PolicyCheckResult {
  allowed: boolean
  reason?: string  // "Email monthly limit reached"
}
```

### 2. **Entitlements** — What features are enabled?

Determines which features/capabilities are available to an org. Used at feature gates.

```typescript
interface IEntitlements {
  canUse(request: EntitlementCheckRequest): Promise<boolean>
}

interface EntitlementCheckRequest {
  organizationId: string
  feature: 'email_inboxes' | 'sms_inboxes' | 'automations' | 'webhooks' | string
}
```

### 3. **Metering** — Record usage

Records metrics for analytics, billing, and reporting. **Never blocks operations.**

```typescript
interface IMetering {
  record(request: MeteringRequest): Promise<void>
}

interface MeteringRequest {
  organizationId: string
  metric: 'emails_processed' | 'sms_processed' | 'api_calls' | string
  quantity: number
  timestamp?: Date
}
```

### Key Design Principles

1. **OSS core is billing-unaware**: Core app calls these interfaces but never knows about plans, subscriptions, or SaaS
2. **OSS implementations are permissive**: AllowAllPolicy, EnableAllEntitlements, NoopMetering (allow everything)
3. **Billing app provides enforcement**: Future SaaS app will implement these interfaces with actual limits
4. **Metering never blocks**: `record()` is fire-and-forget, non-blocking
5. **Policy gates operations**: `check()` returns before operation proceeds

## Data Model

**No billing-related changes to the OSS core.**

The Organization model remains unchanged. Billing data (plans, subscriptions, usage tracking) belongs in the separate billing app.

**Extension point**: The OSS Organization model may store `billingProviderId` or `externalBillingId` (opaque identifier to the SaaS billing system), but this is optional and not required for OSS operation.

```prisma
model Organization {
  id                  String   @id @default(cuid())
  name                String
  slug                String   @unique
  
  // Optional: reference to external billing system (set by SaaS only)
  externalBillingId   String?  // e.g., Stripe customer ID, used by billing app
  
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  
  // ... existing relations ...
}
```

**Why no changes?**
- OSS release doesn't need plans, billing cycles, or usage storage
- Billing app owns all billing/metering data (separate database if desired)
- Clean separation: OSS core ≠ billing system

## Implementation Details

### 1. Interface Definitions

**Location**: `lib/commercial/interfaces.ts`

All three interfaces use async methods and structured request/response objects:

```typescript
export interface PolicyCheckRequest {
  organizationId: string
  action: 'email.process' | 'sms.process' | 'apiKey.create' | 'emailInbox.create' | 'phoneInbox.create'
  quantity?: number  // for rate-limit checks (e.g., "create 5 API keys")
}

export interface PolicyCheckResult {
  allowed: boolean
  reason?: string  // "Email monthly limit reached", "Upgrade plan"
}

export interface IPolicy {
  check(request: PolicyCheckRequest): Promise<PolicyCheckResult>
}

// ---

export interface EntitlementCheckRequest {
  organizationId: string
  feature: 'email_inboxes' | 'sms_inboxes' | 'automations' | 'webhooks' | string
}

export interface IEntitlements {
  canUse(request: EntitlementCheckRequest): Promise<boolean>
}

// ---

export interface MeteringRequest {
  organizationId: string
  metric: 'emails_processed' | 'sms_processed' | 'api_calls' | string
  quantity: number
  timestamp?: Date
}

export interface IMetering {
  record(request: MeteringRequest): Promise<void>
}
```

### 2. CommercialProvider (Dependency Injection)

**Location**: `lib/commercial/provider.ts`

Uses lazy-loading with static getters and private fields. The billing app calls `configure()` to override defaults:

```typescript
export class CommercialProvider {
  private static _policy: IPolicy
  private static _entitlements: IEntitlements
  private static _metering: IMetering

  /**
   * Get the current policy implementation.
   * On first access, lazily loads OSS default (AllowAllPolicy).
   */
  static get policy(): IPolicy {
    if (!this._policy) {
      this._policy = this.createDefaultPolicy()
    }
    return this._policy
  }

  static get entitlements(): IEntitlements {
    if (!this._entitlements) {
      this._entitlements = this.createDefaultEntitlements()
    }
    return this._entitlements
  }

  static get metering(): IMetering {
    if (!this._metering) {
      this._metering = this.createDefaultMetering()
    }
    return this._metering
  }

  /**
   * Configure custom implementations (called by SaaS billing app at startup).
   * 
   * Usage:
   *   CommercialProvider.configure(strictPolicy, planEntitlements, stripeMetering)
   */
  static configure(
    policy: IPolicy,
    entitlements: IEntitlements,
    metering: IMetering
  ): void {
    this._policy = policy
    this._entitlements = entitlements
    this._metering = metering
  }

  // Internal: Lazy-load OSS defaults to avoid circular imports
  private static createDefaultPolicy(): IPolicy {
    const { AllowAllPolicy } = require('./oss/AllowAllPolicy')
    return new AllowAllPolicy()
  }

  private static createDefaultEntitlements(): IEntitlements {
    const { EnableAllEntitlements } = require('./oss/EnableAllEntitlements')
    return new EnableAllEntitlements()
  }

  private static createDefaultMetering(): IMetering {
    const { NoopMetering } = require('./oss/NoopMetering')
    return new NoopMetering()
  }
}
```

### 3. OSS Implementations (Permissive)

**Location**: `lib/commercial/oss/`

Three simple implementations that allow everything and track nothing:

```typescript
// lib/commercial/oss/AllowAllPolicy.ts
export class AllowAllPolicy implements IPolicy {
  async check(request: PolicyCheckRequest): Promise<PolicyCheckResult> {
    return { allowed: true }
  }
}

// lib/commercial/oss/EnableAllEntitlements.ts
export class EnableAllEntitlements implements IEntitlements {
  async canUse(request: EntitlementCheckRequest): Promise<boolean> {
    return true
  }
}

// lib/commercial/oss/NoopMetering.ts
export class NoopMetering implements IMetering {
  async record(request: MeteringRequest): Promise<void> {
    // No-op: OSS doesn't track usage
  }
}

// lib/commercial/oss/index.ts
export { AllowAllPolicy } from './AllowAllPolicy'
export { EnableAllEntitlements } from './EnableAllEntitlements'
export { NoopMetering } from './NoopMetering'
```

### 4. Initialization

**Location**: `lib/commercial/init.ts`

Called at app startup in root layout. Uses lazy-loading so OSS defaults are only created on first use:

```typescript
export async function initializeCommercial(): Promise<void> {
  // For OSS: Defaults are created lazily on first access to CommercialProvider
  // For SaaS: Billing app calls CommercialProvider.configure() before this
  
  if (process.env.ENABLE_BILLING === 'true') {
    console.log('[Commercial] Billing enabled, waiting for billing app to configure...')
  } else {
    console.log('[Commercial] Billing disabled, using OSS defaults (allow all)')
  }
}
```

**Called in root layout** (`app/layout.tsx`):

```typescript
import { initializeCommercial } from '@/lib/commercial/init'

await initializeCommercial()

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

### 5. Integration in Route Handlers

**Before creating resources** (API keys, inboxes):

```typescript
// app/api/v1/apiKeys/route.ts (POST)
import { CommercialProvider } from '@/lib/commercial/provider'

const policyCheck = await CommercialProvider.policy.check({
  organizationId,
  action: 'apiKey.create',
  quantity: 1
})

if (!policyCheck.allowed) {
  return jsonError(policyCheck.reason || 'Operation not allowed', 429)
}

// ... proceed with creation
const apiKey = await prisma.apiKey.create({ ... })
return jsonSuccess(apiKey, 201)
```

**Before processing emails/SMS** (with metering):

```typescript
// app/api/v1/webhooks/email/route.ts
import { CommercialProvider } from '@/lib/commercial/provider'

const policyCheck = await CommercialProvider.policy.check({
  organizationId,
  action: 'email.process',
  quantity: emails.length
})

if (!policyCheck.allowed) {
  return jsonError(policyCheck.reason || 'Email processing not allowed', 429)
}

// Process emails
for (const email of emails) {
  await processEmail(email, inbox)

  // Record usage (non-blocking, never throws)
  await CommercialProvider.metering.record({
    organizationId,
    metric: 'emails_processed',
    quantity: 1
  })
}

return jsonSuccess({}, 200)
```

**Feature gates** (subscription tiers):

```typescript
// app/api/v1/automations/route.ts
import { CommercialProvider } from '@/lib/commercial/provider'

const canUseAutomations = await CommercialProvider.entitlements.canUse({
  organizationId,
  feature: 'automations'
})

if (!canUseAutomations) {
  return jsonError('Automations not available on your plan. Upgrade to Pro.', 403)
}

// ... fetch and return automations
const automations = await prisma.automation.findMany({ where: { organizationId } })
return jsonSuccess(automations)
```

### 6. SaaS Billing App Configuration

**How the separate billing app injects its implementations:**

When the SaaS billing app starts (before or alongside ProgrammableInbox), it:

1. Initializes Stripe client and loads plans from database
2. Creates SaaS implementations of the three interfaces
3. Calls `CommercialProvider.configure()` to override OSS defaults

```typescript
// inboxui-billing/lib/init.ts (separate billing app)
import { CommercialProvider } from '@inboxui/lib/commercial/provider'
import { StrictPolicy } from './StrictPolicy'
import { PlanEntitlements } from './PlanEntitlements'
import { StripeMetering } from './StripeMetering'

export async function initializeCommercial(): Promise<void> {
  const stripe = initializeStripe()
  const plans = await loadPlansFromDatabase()

  CommercialProvider.configure(
    new StrictPolicy(stripe, plans),
    new PlanEntitlements(plans),
    new StripeMetering(stripe)
  )

  console.log('[Billing] Commercial system initialized with SaaS implementations')
}
```

**StrictPolicy example** (enforces Stripe limits):

```typescript
export class StrictPolicy implements IPolicy {
  constructor(private stripe: Stripe, private plans: Plan[]) {}

  async check(request: PolicyCheckRequest): Promise<PolicyCheckResult> {
    const org = await prisma.organization.findUnique({
      where: { id: request.organizationId }
    })

    const subscription = await this.stripe.subscriptions.retrieve(org.stripeSubscriptionId)
    const plan = this.plans.find(p => p.stripePriceId === subscription.items.data[0].price.id)

    switch (request.action) {
      case 'apiKey.create':
        if (org.apiKeyCount >= plan.maxApiKeys) {
          return {
            allowed: false,
            reason: `API key limit (${plan.maxApiKeys}) reached. Upgrade to ${plan.nextTier}.`
          }
        }
        return { allowed: true }

      case 'email.process':
        const monthlyUsage = await this.getMonthlyEmailUsage(request.organizationId)
        if (monthlyUsage + (request.quantity || 1) > plan.emailsPerMonth) {
          return {
            allowed: false,
            reason: `Monthly email limit (${plan.emailsPerMonth}) reached. Usage resets on ${getResetDate()}.`
          }
        }
        return { allowed: true }

      default:
        return { allowed: true }
    }
  }

  private async getMonthlyEmailUsage(organizationId: string): Promise<number> {
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const usage = await prisma.meteringRecord.aggregate({
      where: {
        organizationId,
        metric: 'emails_processed',
        timestamp: { gte: firstDay }
      },
      _sum: { quantity: true }
    })
    return usage._sum.quantity || 0
  }
}
```

**PlanEntitlements example** (tier-based features):

```typescript
export class PlanEntitlements implements IEntitlements {
  private featuresByTier = {
    free: ['email_inboxes'],
    pro: ['email_inboxes', 'sms_inboxes', 'webhooks'],
    enterprise: ['email_inboxes', 'sms_inboxes', 'webhooks', 'automations']
  }

  async canUse(request: EntitlementCheckRequest): Promise<boolean> {
    const org = await prisma.organization.findUnique({
      where: { id: request.organizationId }
    })
    const subscription = await stripe.subscriptions.retrieve(org.stripeSubscriptionId)
    const plan = this.plans.find(p => p.stripePriceId === subscription.items.data[0].price.id)

    return this.featuresByTier[plan.tier].includes(request.feature)
  }
}
```

**StripeMetering example** (records usage, never blocks):

```typescript
export class StripeMetering implements IMetering {
  constructor(private stripe: Stripe) {}

  async record(request: MeteringRequest): Promise<void> {
    // Non-blocking: Fire-and-forget. Never throw from here.
    this.recordAsync(request).catch(error => {
      logger.error({ error, request }, 'Failed to record metric')
    })
  }

  private async recordAsync(request: MeteringRequest): Promise<void> {
    // Record to Stripe Meter for usage-based billing
    await this.stripe.meters.record({
      customer_id: org.stripeCustomerId,
      event_name: request.metric,
      value: request.quantity,
      timestamp: request.timestamp?.getTime() || Date.now()
    })

    // Also store locally for reporting/analytics
    await prisma.meteringRecord.create({
      data: {
        organizationId: request.organizationId,
        metric: request.metric,
        quantity: request.quantity,
        timestamp: request.timestamp || new Date()
      }
    })
  }
}
```

## Future SaaS Offering

When building the **separate billing app** for SaaS:

### Billing App Architecture

```
inboxui/                      (OSS core, unchanged)
  lib/commercial/
    interfaces.ts             (IPolicy, IEntitlements, IMetering)
    provider.ts               (CommercialProvider with lazy-load + configure)
    init.ts                   (initializeCommercial, called in root layout)
    oss/                      (AllowAllPolicy, EnableAllEntitlements, NoopMetering)
  
inboxui-billing/              (NEW: Separate SaaS app repository)
  lib/
    init.ts                   (initializeCommercial with Stripe setup)
    StrictPolicy.ts           (implements IPolicy, enforces plan limits)
    PlanEntitlements.ts       (implements IEntitlements, tier-based features)
    StripeMetering.ts         (implements IMetering, records to Stripe)
  database/
    schema.prisma             (Plans, Subscriptions, MeteringRecords, etc.)
    migrations/
  stripe/
    webhooks.ts               (Subscription events, payment processing)
    client.ts                 (Stripe SDK initialization)
  admin/
    pages/                    (SaaS admin UI for plan management)
    api/                      (Admin API endpoints)
```

### Billing App Responsibilities

1. **Initialize Stripe**: Load Stripe API key, plans, establish meter connections
2. **Implement IPolicy**: `StrictPolicy.check()` enforces Stripe subscription limits
3. **Implement IEntitlements**: `PlanEntitlements.canUse()` determines features by tier
4. **Implement IMetering**: `StripeMetering.record()` sends usage to Stripe Meter API
5. **Configure CommercialProvider**: Call `CommercialProvider.configure()` on startup
6. **Serve admin UI**: Dashboard for subscription management, usage analytics
7. **Stripe webhooks**: Handle subscription creation, cancellation, payment failures
8. **Local metering DB**: Store usage records for analytics/reporting (separate from OSS)

### Integration Flow

**OSS Instance:**
```
app/layout.tsx calls initializeCommercial()
  ├─ CommercialProvider.policy is not set
  ├─ On first access: lazy-loads AllowAllPolicy
  ├─ On first access: lazy-loads EnableAllEntitlements
  └─ On first access: lazy-loads NoopMetering

Request: POST /api/v1/apiKeys
  └─ CommercialProvider.policy.check()
     └─ AllowAllPolicy.check() → { allowed: true }
     └─ ✅ API key created (no limits)
```

**SaaS Instance:**
```
app startup sequence:
  1. inboxui-billing/lib/init.ts calls initializeCommercial()
     ├─ Initialize Stripe SDK
     ├─ Load plans from inboxui-billing DB
     ├─ Create StrictPolicy(stripe, plans)
     ├─ Create PlanEntitlements(plans)
     ├─ Create StripeMetering(stripe)
     └─ CommercialProvider.configure(policy, entitlements, metering)
  
  2. app/layout.tsx calls initializeCommercial()
     ├─ CommercialProvider.policy is ALREADY SET
     └─ Returns immediately (billing app configured it first)

Request: POST /api/v1/apiKeys
  └─ CommercialProvider.policy.check()
     └─ StrictPolicy.check()
        ├─ Fetch org from inboxui DB
        ├─ Query Stripe for subscription
        ├─ Count existing API keys in inboxui DB
        ├─ If at limit: { allowed: false, reason: "Upgrade plan..." }
        └─ If OK: { allowed: true }
        └─ ✅ or ❌ (depending on tier)

Request: POST /api/v1/webhooks/email
  ├─ CommercialProvider.policy.check() → { allowed: true } or rejected
  ├─ Process email
  └─ CommercialProvider.metering.record()
     └─ StripeMetering.record()
        ├─ Send to Stripe Meter API
        └─ Store in inboxui-billing DB
```

### Data Isolation

**ProgrammableInbox Database** (shared between OSS and SaaS):
- Users, Organizations, Memberships
- EmailInbox, PhoneInbox, EmailMessage, SMSMessage
- Automation, AutomationTrigger, AutomationAction
- ApiKey, Webhook
- (unchanged in SaaS — all app data lives here)

**ProgrammableInbox-Billing Database** (SaaS only):
- Plan (pricing tiers, limits, features)
- Subscription (active subscriptions, billing cycles)
- MeteringRecord (usage metrics for analytics)
- Invoice (billing history)
- BillingEvent (webhook audit log)

**Shared Reference**:
```prisma
model Organization {
  id                String   @id
  // ... existing fields ...
  externalBillingId String?  @unique  // Stripe customer ID (SaaS only)
}
```

The `externalBillingId` is opaque to ProgrammableInbox core — only the billing app knows its meaning.

### Key Benefits

✅ **OSS release has zero billing dependencies**
   - No Stripe SDK, Redis, or external services required
   - Just 3 no-op implementations (AllowAll, EnableAll, Noop)
   - `npm install` is lightweight
   
✅ **Billing app is completely separate**
   - Separate repository (inboxui-billing)
   - Separate database (optional, can be same Postgres instance)
   - Can be upgraded/deployed independently
   - Can be rewritten/replaced without touching ProgrammableInbox
   
✅ **Clean interfaces make it testable**
   - Mock IPolicy, IEntitlements, IMetering in tests
   - No coupling between OSS and SaaS
   - Easy to test both scenarios
   
✅ **No code duplication**
   - Route handlers have one version (used by both OSS and SaaS)
   - Business logic lives in policy/entitlements (swappable)
   - Integration points are explicit
   
✅ **Future extensibility**
   - Easy to add new actions (policy.check actions)
   - Easy to add new features (entitlements)
   - Easy to add new metrics (metering)
   - Can swap payment providers (replace Stripe with Paddle, etc.)
   - Can implement custom policies (per-customer limits)

## Scope & Assumptions

**In Scope** (OSS Core):
- Define IPolicy, IEntitlements, IMetering interfaces
- Implement permissive OSS versions (AllowAll, EnableAll, Noop)
- Create CommercialProvider for dependency injection
- Integrate policy checks before creating resources (API keys, inboxes)
- Integrate policy checks before processing emails/SMS
- Integrate feature gates for subscription features
- Integrate metering calls for usage tracking
- Optional: Add `Organization.externalBillingId` field for future SaaS reference

**Out of Scope** (for separate billing app later):
- Actual policy enforcement (StrictPolicy, RateLimitPolicy)
- Plan management (Plan model, pricing tiers)
- Subscription management (subscriptions, billing cycles)
- Usage tracking database (Redis, PostgreSQL for metering)
- Stripe integration
- Admin UI for billing
- Invoicing and payment processing
- Monitoring and analytics dashboards

**Assumptions**:
- OSS release will never have billing enabled; it's a separate decision/codebase
- Policy.check() is called at operation time (before resources are created/processed)
- Metering.record() is async and non-blocking (fire-and-forget)
- Entitlements.canUse() is called at feature gate points
- CommercialProvider implementations can be swapped at startup without app changes

## Testing Strategy

### Unit Tests (lib/commercial/)

**OSS implementations** (verify they allow everything):

```typescript
// AllowAllPolicy always allows
it('allows all operations', async () => {
  const policy = new AllowAllPolicy()
  const result = await policy.check({ organizationId: 'org-1', action: 'apiKey.create' })
  expect(result.allowed).toBe(true)
})

// EnableAllEntitlements always returns true
it('enables all features', async () => {
  const ent = new EnableAllEntitlements()
  const result = await ent.canUse({ organizationId: 'org-1', feature: 'automations' })
  expect(result).toBe(true)
})

// NoopMetering never throws
it('records metrics without error', async () => {
  const metering = new NoopMetering()
  await expect(metering.record({ organizationId: 'org-1', metric: 'emails_processed', quantity: 1000 }))
    .resolves.toBeUndefined()
})
```

**CommercialProvider** (verify lazy-loading and injection):

```typescript
it('uses OSS defaults on first access', () => {
  const policy = CommercialProvider.policy
  expect(policy).toBeInstanceOf(AllowAllPolicy)
})

it('allows swapping implementations via configure()', () => {
  const mockPolicy = { check: async () => ({ allowed: false, reason: 'Limited' }) }
  CommercialProvider.configure(mockPolicy, /* ... */)
  expect(CommercialProvider.policy).toBe(mockPolicy)
})

it('policy.check() returns rejection when configured', async () => {
  const mockPolicy = { check: async () => ({ allowed: false, reason: 'Limit exceeded' }) }
  CommercialProvider.configure(mockPolicy, /* ... */)
  const result = await CommercialProvider.policy.check({ organizationId: 'org-1', action: 'apiKey.create' })
  expect(result.allowed).toBe(false)
  expect(result.reason).toBe('Limit exceeded')
})
```

### Integration Tests (in route handler test files)

**API key creation tests**:

```typescript
// OSS: Should allow creation (AllowAllPolicy is permissive)
it('POST /api/v1/apiKeys allows creation (OSS)', async () => {
  const response = await POST(mockRequest)
  expect(response.status).toBe(201)
  expect(response.body.data.id).toBeDefined()
})

// SaaS: Should reject when at limit (mock StrictPolicy)
it('POST /api/v1/apiKeys rejects at limit (SaaS)', async () => {
  const mockPolicy = {
    check: async () => ({ allowed: false, reason: 'API key limit reached' })
  }
  CommercialProvider.configure(mockPolicy, /* ... */)

  const response = await POST(mockRequest)
  expect(response.status).toBe(429)
  expect(response.body.message).toContain('API key limit')
})
```

**Email webhook tests**:

```typescript
// OSS: Should process and record (metering is no-op)
it('POST /api/v1/webhooks/email processes and records metrics (OSS)', async () => {
  const response = await POST(mockRequest)
  expect(response.status).toBe(200)
  // Metering was called (but was no-op)
})

// SaaS: Should reject when at email limit and record properly
it('POST /api/v1/webhooks/email rejects at monthly limit (SaaS)', async () => {
  const mockPolicy = {
    check: async () => ({ allowed: false, reason: 'Monthly email limit reached' })
  }
  const mockMetering = { record: vi.fn().mockResolvedValue(undefined) }
  CommercialProvider.configure(mockPolicy, /* ... */, mockMetering)

  const response = await POST(mockRequest)
  expect(response.status).toBe(429)
  // Metering was NOT called (request was rejected before processing)
})

// Should record metrics for successful emails
it('POST /api/v1/webhooks/email records metrics for processed emails', async () => {
  const mockMetering = { record: vi.fn().mockResolvedValue(undefined) }
  CommercialProvider.configure(/* ... */, mockMetering)

  const response = await POST(mockRequestWith3Emails)
  expect(mockMetering.record).toHaveBeenCalledTimes(3)
  expect(mockMetering.record).toHaveBeenCalledWith({
    organizationId: 'org-1',
    metric: 'emails_processed',
    quantity: 1
  })
})
```

**Feature gate tests**:

```typescript
// OSS: All features available
it('GET /api/v1/automations shows automations (OSS)', async () => {
  const response = await GET(mockRequest)
  expect(response.status).toBe(200)
  expect(response.body.data).toHaveLength(2)
})

// SaaS: Feature gated by tier
it('GET /api/v1/automations rejects free tier (SaaS)', async () => {
  const mockEntitlements = {
    canUse: async ({ feature }) => feature !== 'automations'  // Only free tier
  }
  CommercialProvider.configure(/* ... */, mockEntitlements, /* ... */)

  const response = await GET(mockRequest)
  expect(response.status).toBe(403)
  expect(response.body.message).toContain('not available on your plan')
})
```

### Test Coverage Goals

- ✅ OSS default behavior (AllowAll, EnableAll, Noop)
- ✅ Provider lazy-loading and injection
- ✅ Route handlers call policy.check() at correct points
- ✅ Route handlers call metering.record() after processing
- ✅ Route handlers call entitlements.canUse() at feature gates
- ✅ Rejected operations return 429 (Too Many Requests)
- ✅ Rejected features return 403 (Forbidden)
- ✅ Metering never blocks or throws (fire-and-forget)
- ✅ Both OSS and SaaS behaviors work correctly

## Files to Create/Modify

### New Files (Commercial Layer)

**Core Infrastructure**:
- `lib/commercial/interfaces.ts` — IPolicy, IEntitlements, IMetering with request/response types
- `lib/commercial/provider.ts` — CommercialProvider static class with lazy-loading + configure()
- `lib/commercial/init.ts` — initializeCommercial() function called from root layout

**OSS Implementations** (3 no-op classes):
- `lib/commercial/oss/AllowAllPolicy.ts` — Always returns `{ allowed: true }`
- `lib/commercial/oss/EnableAllEntitlements.ts` — Always returns `true`
- `lib/commercial/oss/NoopMetering.ts` — Always succeeds (discards metrics)
- `lib/commercial/oss/index.ts` — Export all OSS implementations

### Tests

**Commercial Layer Tests**:
- `lib/commercial/__tests__/AllowAllPolicy.test.ts` — Verify it allows all operations
- `lib/commercial/__tests__/EnableAllEntitlements.test.ts` — Verify it enables all features
- `lib/commercial/__tests__/NoopMetering.test.ts` — Verify it's a no-op (never throws)
- `lib/commercial/__tests__/provider.test.ts` — Test lazy-loading and configure() behavior

**Integration Tests** (in existing test files):
- `app/api/v1/apiKeys/__tests__/route.test.ts` — Mock policy to test rejection scenarios
- `app/api/v1/webhooks/email/__tests__/integration.test.ts` — Mock policy/metering to verify calls
- `app/api/v1/automations/__tests__/route.test.ts` — Mock entitlements to test feature gates

### Modified Files (ProgrammableInbox Route Handlers)

**Add policy checks (before resource creation)**:
- `app/api/v1/apiKeys/route.ts` (POST) — Add policy.check() for 'apiKey.create'
- `app/api/v1/emailInbox/route.ts` (POST) — Add policy.check() for 'emailInbox.create'
- `app/api/v1/phoneInbox/route.ts` (POST) — Add policy.check() for 'phoneInbox.create'

**Add policy + metering (before processing)**:
- `app/api/v1/webhooks/email/route.ts` — Add policy.check('email.process') + metering.record('emails_processed')
- `app/api/v1/webhooks/sms/route.ts` (if exists) — Add policy.check('sms.process') + metering.record('sms_processed')

**Add entitlements.canUse() (feature gates)**:
- `app/api/v1/automations/route.ts` (GET/POST) — Add entitlements.canUse('automations')

**Root layout**:
- `app/layout.tsx` — Call `initializeCommercial()` at app startup

### Schema Changes

**Minimal change** (optional extension point for SaaS):
- `prisma/schema.prisma` — Add `externalBillingId: String? @unique` to Organization model
  - This field is optional and only used by SaaS billing app
  - OSS core ignores it
  - Allows billing app to link Stripe customers to organizations

## Success Criteria

### Code Quality

- ✅ Three interfaces (IPolicy, IEntitlements, IMetering) defined with clear contracts
- ✅ OSS implementations (AllowAllPolicy, EnableAllEntitlements, NoopMetering) are < 10 lines each
- ✅ CommercialProvider uses lazy-loading to avoid circular dependencies
- ✅ CommercialProvider.configure() is the single injection point
- ✅ All route handlers use consistent pattern: `CommercialProvider.policy.check()` or `.canUse()`

### Architecture

- ✅ OSS core has **zero imports** from Stripe, Redis, or billing-related packages
- ✅ OSS core is **billing-unaware** — no mention of plans, subscriptions, limits
- ✅ Route handlers are **identical** in OSS and SaaS (no `#ifdef BILLING` or `if (billing)`)
- ✅ Integration points are **explicit** — every `policy.check()` and `metering.record()` is visible in source
- ✅ Metering is **non-blocking** — `await record()` never throws or returns error
- ✅ Rejected operations return **HTTP 429** (Too Many Requests) for policy failures

### Testing

- ✅ Unit tests verify AllowAllPolicy always allows
- ✅ Unit tests verify EnableAllEntitlements always enables
- ✅ Unit tests verify NoopMetering never throws
- ✅ Integration tests verify policy.check() is called before resource creation
- ✅ Integration tests verify metering.record() is called after processing
- ✅ Integration tests verify entitlements.canUse() gates features
- ✅ Mock tests show SaaS behavior (configuring with StrictPolicy)
- ✅ All tests pass for both OSS defaults and mocked SaaS implementations

### Deployment

- ✅ OSS release has **no new dependencies** (interfaces are TypeScript only)
- ✅ `npm install` works without Stripe/Redis (in OSS)
- ✅ OSS release works **unchanged** from main codebase (no separate builds)
- ✅ SaaS billing app **can be built separately** (imports from inboxui, overrides via configure)
- ✅ SaaS startup sequence: billing app → configure CommercialProvider → inboxui starts

### Future-Proofing

- ✅ Adding new actions requires only 1 line (add to PolicyCheckRequest union type)
- ✅ Adding new features requires only 1 line (add to EntitlementCheckRequest union type)
- ✅ Adding new metrics requires only 1 line (add to MeteringRequest metric union)
- ✅ Swapping payment providers (Stripe → Paddle) requires only reimplementing 3 classes
- ✅ Organization model has optional `externalBillingId` for future SaaS linking
