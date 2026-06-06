# Programmable Inbox: OSS + SaaS Architecture

## Goals

Programmable Inbox will be released as an open-source project while maintaining a commercial SaaS offering.

The architecture should satisfy the following goals:

### Open Source Users

- Self-hostable
- No billing dependencies
- No Stripe dependency
- No licensing server
- Unlimited usage by default
- Full inbox functionality
- Full automation functionality

### SaaS Offering

- Subscription plans
- Usage-based billing
- Rate limits
- Quotas
- Tenant entitlements
- Admin tooling
- Analytics
- Premium features

### Engineering Goals

- Single core codebase
- Avoid maintaining forks
- Minimal SaaS-specific code in OSS
- Clear separation of concerns
- Ability to add future monetization features

---

# Recommended Architecture

Use three abstractions:

```text
Policy
Entitlements
Metering
```

instead of a generic plugin framework.

---

# High-Level Architecture

```text
                 ┌───────────────────┐
                 │ Programmable Inbox │
                 │      OSS Core      │
                 └─────────┬─────────┘
                           │
                           ▼

                ┌─────────────────────┐
                │ Policy Interface    │
                └─────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼

┌─────────────────────┐          ┌─────────────────────┐
│ OSS Policy Provider │          │ SaaS Policy Provider│
│ Allow Everything    │          │ Billing/Quotas      │
└─────────────────────┘          └─────────────────────┘
```

The OSS core never knows whether billing exists.

It only knows:

```ts
policy.check(...)
metering.record(...)
entitlements.canUse(...)
```

---

# Core Abstractions

## Policy Service

Policy decides whether an action is allowed.

```ts
await policy.check({
  tenantId,
  action: "email.process",
  quantity: 1
})
```

## Entitlement Service

Entitlements determine what features are enabled.

```ts
await entitlements.canUse({
  tenantId,
  feature: "sms_inbox"
})
```

## Metering Service

Metering records usage.

```ts
await metering.record({
  tenantId,
  metric: "emails_processed",
  quantity: 1
})
```

Metering should never block processing.

---

# OSS Implementations

```ts
export class AllowAllPolicy {
  async check() {
    return { allowed: true };
  }
}

export class OSSEntitlements {
  async canUse() {
    return true;
  }
}

export class NoopMetering {
  async record() {}
}
```

---

# SaaS Implementations

Private repository:

```text
programmable-inbox-saas
```

Contains:

- Stripe
- Billing
- Usage tracking
- Rate limiting
- Plans
- Tenant management

---

# Usage Metrics

```text
emails_processed
sms_processed
automation_runs
webhook_deliveries
storage_gb
inboxes
phone_numbers
api_calls
```

---

# Repository Structure

## OSS

```text
programmable-inbox/

apps/
  api/
  worker/
  web/

packages/
  core/
  policy/
  metering/
  entitlements/
```

## Private SaaS

```text
programmable-inbox-saas/

billing/
stripe/
usage/
plans/
admin/
analytics/
```

---

# Final Recommendation

Use Policy + Entitlements + Metering as the commercial boundary.

Keep the OSS version unrestricted and inject SaaS behavior through implementations of those interfaces rather than building a large generic plugin framework.
