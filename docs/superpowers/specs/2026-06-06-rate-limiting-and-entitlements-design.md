# Rate Limiting & Entitlements Design

**Date**: 2026-06-06  
**Status**: Draft  
**Issue**: #9 - Build per-organization rate limit feature

## Overview

InboxUI will be released as an open-source, self-hostable application. This design implements three clean abstractions—**Policy**, **Entitlements**, and **Metering**—that define the commercial boundary between the OSS core and future SaaS billing.

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

```typescript
// Policy: Check if an action is allowed
export interface IPolicy {
  check(request: PolicyCheckRequest): Promise<PolicyCheckResult>
}

export interface PolicyCheckRequest {
  organizationId: string
  action: 'email.process' | 'sms.process' | 'apiKey.create' | 'emailInbox.create' | 'phoneInbox.create'
  quantity?: number
}

export interface PolicyCheckResult {
  allowed: boolean
  reason?: string
}

// Entitlements: What features are enabled
export interface IEntitlements {
  canUse(request: EntitlementCheckRequest): Promise<boolean>
}

export interface EntitlementCheckRequest {
  organizationId: string
  feature: string  // 'email_inboxes', 'sms_inboxes', 'automations', etc.
}

// Metering: Record usage (never blocks)
export interface IMetering {
  record(request: MeteringRequest): Promise<void>
}

export interface MeteringRequest {
  organizationId: string
  metric: string  // 'emails_processed', 'sms_processed', 'api_calls', etc.
  quantity: number
  timestamp?: Date
}
```

### 2. OSS Implementations (Permissive)

**Location**: `lib/commercial/oss/`

```typescript
// lib/commercial/oss/AllowAllPolicy.ts
export class AllowAllPolicy implements IPolicy {
  async check(): Promise<PolicyCheckResult> {
    return { allowed: true }
  }
}

// lib/commercial/oss/EnableAllEntitlements.ts
export class EnableAllEntitlements implements IEntitlements {
  async canUse(): Promise<boolean> {
    return true
  }
}

// lib/commercial/oss/NoopMetering.ts
export class NoopMetering implements IMetering {
  async record(): Promise<void> {
    // No-op: OSS doesn't track usage
  }
}
```

### 3. Service Provider (Dependency Injection)

**Location**: `lib/commercial/provider.ts`

```typescript
export class CommercialProvider {
  static policy: IPolicy = new AllowAllPolicy()
  static entitlements: IEntitlements = new EnableAllEntitlements()
  static metering: IMetering = new NoopMetering()
  
  static configure(
    policy: IPolicy,
    entitlements: IEntitlements,
    metering: IMetering
  ) {
    this.policy = policy
    this.entitlements = entitlements
    this.metering = metering
  }
}
```

### 4. Integration in Route Handlers

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
```

**Before processing emails/SMS**:

```typescript
// app/api/v1/webhooks/email/route.ts
import { CommercialProvider } from '@/lib/commercial/provider'

const policyCheck = await CommercialProvider.policy.check({
  organizationId,
  action: 'email.process',
  quantity: 1
})

if (!policyCheck.allowed) {
  return jsonError('Email processing limit reached', 429)
}

// ... process email
await CommercialProvider.metering.record({
  organizationId,
  metric: 'emails_processed',
  quantity: 1
})
```

**Feature gates**:

```typescript
// app/api/v1/automations/route.ts
const canUseAutomations = await CommercialProvider.entitlements.canUse({
  organizationId,
  feature: 'automations'
})

if (!canUseAutomations) {
  return jsonError('Automations not available on your plan', 403)
}
```

### 5. Configuration

No `.env` changes required for OSS. The core app uses permissive implementations by default.

**Future SaaS app** will inject its own implementations:

```typescript
// When SaaS app starts (separate billing app):
import { StrictPolicy } from '@/billing/StrictPolicy'
import { PlanEntitlements } from '@/billing/PlanEntitlements'
import { StripeMetering } from '@/billing/StripeMetering'

CommercialProvider.configure(
  new StrictPolicy(),
  new PlanEntitlements(),
  new StripeMetering()
)
```

## Future SaaS Offering

When building the **separate billing app** for SaaS:

### Billing App Architecture

```
inboxui/                      (OSS core, unchanged)
  lib/commercial/
    interfaces.ts             (IPolicy, IEntitlements, IMetering)
    oss/                      (AllowAllPolicy, etc.)
    provider.ts               (CommercialProvider, dependency injection)
  
inboxui-billing/              (NEW: Separate SaaS app)
  StrictPolicy.ts             (implements IPolicy)
  PlanEntitlements.ts         (implements IEntitlements)
  StripeMetering.ts           (implements IMetering)
  database/                   (plans, subscriptions, usage, etc.)
  stripe/                     (Stripe integration)
  admin/                      (SaaS admin UI)
```

### Billing App Responsibilities

1. **Store billing data**: Plans, subscriptions, usage tracking, billing cycles
2. **Implement IPolicy**: Check organization limits (API keys, inboxes, emails/month)
3. **Implement IEntitlements**: Determine enabled features based on subscription tier
4. **Implement IMetering**: Track usage for billing (store in its own database, not OSS core)
5. **Serve admin UI**: Manage subscriptions, plans, analytics
6. **Integrate Stripe**: Payment processing, webhooks
7. **Inject implementations**: Call `CommercialProvider.configure()` on startup

### Integration Flow

```
SaaS Instance Startup:
  1. Load OSS core (uses AllowAllPolicy by default)
  2. Billing app injects StrictPolicy, PlanEntitlements, StripeMetering
  3. OSS core calls CommercialProvider.policy.check() → gets SaaS limits
  4. OSS core calls CommercialProvider.metering.record() → goes to Stripe/billing DB
  5. Billing app handles subscription management, invoicing, etc.

OSS Instance Startup:
  1. Load OSS core
  2. Use default AllowAllPolicy, EnableAllEntitlements, NoopMetering
  3. No limits, no tracking, no dependencies
```

### Data Isolation

- **OSS core database**: Users, Organizations, Inboxes, Messages, Automations, API Keys
- **Billing app database**: Plans, Subscriptions, UsageMetrics, Invoices, Billing Cycles
- **Shared identifier**: `Organization.externalBillingId` (opaque to OSS, known to billing app)

### Key Benefits

✅ **OSS release has zero billing dependencies**  
✅ **Billing app is completely separate** (can be upgraded/deployed independently)  
✅ **Clean interfaces** make it easy to swap implementations  
✅ **No code duplication** between OSS and SaaS  
✅ **Future extensibility** (e.g., add custom metering, different payment providers)

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

1. **Unit tests for interfaces**:
   - AllowAllPolicy always allows
   - EnableAllEntitlements always returns true
   - NoopMetering always succeeds (no-op)

2. **Unit tests for CommercialProvider**:
   - Default implementations are correct
   - Swap/configure() changes implementations
   - Multiple configurations in test don't interfere

3. **Integration tests for route handlers**:
   - API key creation calls policy.check()
   - Email webhook calls policy.check() and metering.record()
   - Failed policy check returns 429
   - Feature gates call entitlements.canUse()

4. **Mocking tests** (for future SaaS):
   - Mock StrictPolicy and verify API key creation is blocked
   - Mock RestrictiveMetering and verify metering calls are made
   - Verify OSS core doesn't change when billing implementations are injected

Tests should cover:
- Allowed vs. rejected operations
- Feature available vs. unavailable
- Metering calls are made but don't block
- Default implementations match expected behavior

## Files to Create/Modify

**New Files**:
- `lib/commercial/interfaces.ts` — IPolicy, IEntitlements, IMetering interface definitions
- `lib/commercial/provider.ts` — CommercialProvider with dependency injection
- `lib/commercial/oss/AllowAllPolicy.ts` — permissive policy implementation
- `lib/commercial/oss/EnableAllEntitlements.ts` — enable-all entitlements implementation
- `lib/commercial/oss/NoopMetering.ts` — no-op metering implementation
- `lib/commercial/oss/index.ts` — export all OSS implementations

**Tests**:
- `lib/commercial/__tests__/interfaces.test.ts` — interface contract tests
- `lib/commercial/__tests__/provider.test.ts` — CommercialProvider injection tests
- `lib/commercial/oss/__tests__/AllowAllPolicy.test.ts` — verify it allows everything
- `lib/commercial/oss/__tests__/EnableAllEntitlements.test.ts` — verify it enables everything
- `lib/commercial/oss/__tests__/NoopMetering.test.ts` — verify it's a no-op

**Modified Files**:
- `prisma/schema.prisma` — add optional `externalBillingId` to Organization
- `app/api/v1/apiKeys/route.ts` (POST) — add `policy.check()` for apiKey.create
- `app/api/v1/emailInbox/route.ts` (POST) — add `policy.check()` for emailInbox.create
- `app/api/v1/phoneInbox/route.ts` (POST) — add `policy.check()` for phoneInbox.create
- `app/api/v1/webhooks/email/route.ts` — add `policy.check()` and `metering.record()` for email processing
- `app/api/v1/webhooks/sms/route.ts` (if exists) — add policy/metering for SMS
- `app/api/v1/automations/route.ts` — add `entitlements.canUse()` for automation feature

## Success Criteria

- ✅ OSS core has zero knowledge of billing, plans, or subscriptions
- ✅ Three interfaces (IPolicy, IEntitlements, IMetering) are well-defined and testable
- ✅ OSS implementations (AllowAll, EnableAll, Noop) are simple and correct
- ✅ CommercialProvider enables runtime injection of SaaS implementations
- ✅ All policy checks are made before resources are created or processed
- ✅ All metering calls are non-blocking and don't affect operation flow
- ✅ Integration points in route handlers are explicit and easy to find
- ✅ OSS release can run without any billing-related code changes
- ✅ Separate billing app can implement interfaces and inject at startup
- ✅ No Redis, Stripe, or other SaaS dependencies in OSS core
