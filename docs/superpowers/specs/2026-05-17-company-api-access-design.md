# Company-Scoped External API Access — ProgrammableInbox Design Spec

**Date**: 2026-05-17  
**Status**: APPROVED  
**Scope**: Design a company-accessible external API for inboxes and messages with JWT user auth for the app, scoped API-key auth for external callers, a shared authorization/service layer, and published OpenAPI/Swagger documentation.

---

## 1. Overview

ProgrammableInbox already exposes application routes under `/api/v1`, but those routes are currently designed around authenticated users rather than external organization consumers.

Current repo evidence:
- `lib/auth-server.ts` only resolves `Authorization: Bearer ...` as a JWT-backed user and returns memberships.
- `app/api/v1/apiKeys/route.ts` creates API keys in the database, but those keys are not used for request authentication.
- `app/api/v1/emailInbox/route.ts` and `app/api/v1/emailInbox/[id]/messages/route.ts` authorize primarily through `userId` ownership checks, not through an organization + scope model.
- `lib/api/*.api.ts` wrappers reference an “OpenAPI spec” in comments, but there is no obvious published OpenAPI document or Swagger UI endpoint in the current codebase.

The goal is to make APIs externally accessible per company without building a second unrelated API stack. The design should keep one domain/service layer, one authorization policy model, and one durable public contract, while allowing the app and the public API to keep different transport ergonomics where needed.

The first public version is read-only:
- list/get inboxes
- list/get messages
- thread views and filtering where useful

Write operations such as sending email, creating inboxes, mutating tags, and administrative operations are out of scope for v1.

---

## 2. Goals

- Allow external API access using organization-scoped API keys.
- Keep JWT user auth for the first-party app.
- Support scoped permissions per API key from day one.
- Expose inbox and message data through a stable public contract.
- Publish API documentation through OpenAPI and Swagger UI.
- Prevent major drift between internal and external API behavior by sharing authz and service logic.

---

## 3. Non-Goals

- Full contract unification where the app must consume the exact same route shapes as the public API.
- Write/mutate operations in the first external release.
- Per-field or highly granular authorization scopes.
- OAuth, third-party delegated auth, or user-scoped external auth.
- Documenting every internal route in the current app.

---

## 4. Recommended Architecture

### Recommendation

Adopt a **shared service layer with two transport adapters**:
- app-facing routes continue to serve UI needs
- public routes define the stable external contract
- both call the same shared query and authorization layer

This was chosen over:
- a thin facade over existing routes, because current user-centric checks would leak into the external model
- full immediate route unification, because that would combine auth redesign, public-contract design, and frontend migration into one risky step

### Design Principle

The app API and the public API may differ in route shape, pagination ergonomics, or convenience endpoints, but they should not diverge on:
- principal model
- organization boundary rules
- scope checks
- core resource semantics
- canonical DTO definitions for public resources

---

## 5. Authentication Model

All protected API traffic continues to use the `Authorization: Bearer <token>` header, but the bearer token can now resolve to one of two principal types.

### A. User Principal

Backed by the current JWT flow.

```ts
type UserPrincipal = {
  kind: 'user'
  userId: string
  organizations: Array<{
    organizationId: string
    role: string
  }>
}
```

Use cases:
- first-party app requests
- user-driven workflows that depend on membership/role context

### B. API Key Principal

Backed by a company API key.

```ts
type ApiKeyPrincipal = {
  kind: 'apiKey'
  apiKeyId: string
  organizationId: string
  scopes: string[]
}
```

Use cases:
- external integrations
- server-to-server organization access

### C. Shared Auth Context

Route handlers and services should consume a single resolved principal type:

```ts
type AuthContext = UserPrincipal | ApiKeyPrincipal
```

This replaces the pattern where each route directly assumes “authenticated user” and then performs ad hoc ownership checks.

---

## 6. Authorization Model

Authorization must move below the route layer into shared helpers/services so that JWT users and API-key callers follow the same access rules.

Recommended helpers:
- `requireOrgAccess(ctx, organizationId)`
- `requireScope(ctx, 'inboxes:read')`
- `requireScope(ctx, 'messages:read')`
- `requireInboxAccess(ctx, inboxId)`
- `requireMessageAccess(ctx, messageId)`

### Rules

- User JWT requests are authorized through organization memberships and role rules.
- API key requests are authorized through:
  - the key’s fixed `organizationId`
  - the key’s explicit scopes
- Cross-organization access is always denied.
- Message access is derived from organization ownership, not from caller-supplied identifiers alone.

### Why This Is Necessary

Current routes show user-owned assumptions that do not fit a company-access API:
- `app/api/v1/emailInbox/route.ts` lists inboxes by `{ userId: user.id }`
- `app/api/v1/emailInbox/[id]/messages/route.ts` checks `inbox.userId !== user.id`

Those checks are reasonable for the current UI, but they are not the correct long-term boundary for externally accessible company APIs. The new boundary should be organization + scope.

---

## 7. API Key Model

### Day-One Scope Model

Start with resource-family scopes:
- `inboxes:read`
- `messages:read`

Optional later:
- `threads:read`
- `inboxes:write`
- `messages:write`
- `webhooks:read`
- `webhooks:write`

### Key Behavior

- An API key belongs to exactly one organization.
- A key can only access resources from that organization.
- A key may have one or more scopes.
- Missing scope returns `403 Forbidden`.

### Storage Requirement

Do not keep externally usable API keys in plaintext once this becomes a real external contract.

Recommended storage behavior:
- generate a raw key once
- show it once to the creator
- store only a hash + prefix metadata in the database
- use the prefix for lookup and the hash for verification

This is a required hardening step before positioning API keys as a public integration mechanism.

---

## 8. Public API Surface

The first public version is read-only and organization-scoped.

Recommended public endpoints:
- `GET /api/v1/inboxes`
- `GET /api/v1/inboxes/{id}`
- `GET /api/v1/inboxes/{id}/messages`
- `GET /api/v1/messages/{id}`

Optional read helpers if they are useful and stable:
- `GET /api/v1/messages?threadId=...`
- `GET /api/v1/threads/{id}/messages`

### Query Parameters

Common filters:
- `page`
- `limit`
- `threadId`
- `from`
- `to`
- `tag`
- `search`

Rules:
- API key callers do not need to send `organizationId`; the key fixes org context.
- JWT callers may need org selection only when the user belongs to multiple organizations and the route cannot infer context.

### Route-Shaping Rule

The app may keep UI-oriented routes if needed, but the public endpoints above should be treated as the stable integration contract. Shared services should feed both.

---

## 9. Shared Service Layer

Introduce a shared query/authorization layer that sits between route handlers and Prisma.

Suggested responsibilities:

### A. Principal Resolution

Resolve the bearer token into `AuthContext`.

Responsibilities:
- detect JWT vs API key
- verify token/key
- load memberships or scopes
- return a normalized principal object

### B. Authorization Policy

Centralize all organization and scope checks.

Responsibilities:
- org membership checks for users
- org identity checks for API keys
- scope validation
- reusable deny behavior

### C. Resource Query Services

Shared read services for inboxes and messages.

Responsibilities:
- list inboxes visible to the principal
- fetch a single inbox if visible
- list messages for an inbox with filters and pagination
- fetch a single message if visible

### D. DTO / Schema Layer

Canonical serializers/schemas for public resources.

Responsibilities:
- stable response payload definitions
- schema reuse across docs, routes, and tests
- prevent route-level shape drift

This layer is the main anti-divergence mechanism. The app and the external API do not need identical routes, but they should not each invent different business rules or incompatible core read models.

---

## 10. OpenAPI And Swagger Strategy

Treat the public API contract as a first-class artifact in the repo.

### Recommendation

Use a **code-first OpenAPI** approach.

Reasoning:
- the repo already has route code and handwritten client wrappers
- there are comments implying an OpenAPI mindset, but no obvious maintained spec artifact
- code-first enables incremental adoption without rewriting the whole API around spec-first generation

### Deliverables

- raw OpenAPI JSON endpoint, e.g. `/api/openapi.json`
- Swagger UI page, e.g. `/api/docs`
- route-adjacent schemas that generate the documented contract

### Documentation Rules

- Document the stable public API only.
- Do not automatically expose every internal route in Swagger.
- Internal convenience routes can remain undocumented or explicitly internal.
- Public DTOs should come from shared schema definitions rather than ad hoc route responses.

---

## 11. Drift-Control Rules

To keep internal and external APIs from drifting too far apart:

1. Auth resolution must come from one shared module.
2. Authorization checks must come from one shared policy layer.
3. Public resource DTOs must come from shared schema/serializer code.
4. Public route tests must validate against the documented schemas.
5. App routes should reuse the same service/query layer whenever they expose the same business entities.

Acceptable divergence:
- route naming convenience for the UI
- batching or aggregation helpers needed only by the UI
- internal-only endpoints that are not part of the public contract

Unacceptable divergence:
- different org access rules
- different definitions of what an inbox or message response contains without explicit versioning
- app-only “hidden” fields becoming required behavior for public consumers

---

## 12. Testing Strategy

### A. Auth Resolution Tests

Cover:
- valid JWT resolves to `UserPrincipal`
- valid API key resolves to `ApiKeyPrincipal`
- invalid bearer token returns unauthorized
- revoked or unknown API key returns unauthorized

### B. Authorization Tests

Cover:
- same-org access allowed
- cross-org access denied
- missing scope denied
- user membership required for JWT requests

### C. Contract Tests

Cover:
- public responses conform to documented OpenAPI schemas
- docs generation includes all public endpoints
- undocumented internal routes are excluded from the public spec

### D. Regression Tests

Cover:
- existing app flows continue working under JWT auth
- existing inbox/message UI still receives compatible data from shared services

---

## 13. Rollout Strategy

### Phase 1

- introduce shared auth context and principal resolution
- introduce shared authorization helpers
- keep existing app behavior working

### Phase 2

- build public read-only inbox/message routes on top of shared services
- add scoped API-key enforcement

### Phase 3

- publish OpenAPI JSON and Swagger UI
- add contract tests

### Phase 4

- gradually migrate app routes to reuse the same shared query/DTO modules where appropriate

This allows external access to ship without forcing a full frontend route rewrite first.

---

## 14. Risks And Mitigations

### Risk: Current ownership model is user-centric

Mitigation:
- move authz to organization-aware helpers before expanding the public surface

### Risk: API keys stored in plaintext are unsafe for public use

Mitigation:
- move to one-time display plus hashed storage before external release

### Risk: Swagger docs become stale

Mitigation:
- generate from shared route/schema code and add contract tests in CI

### Risk: Internal and external APIs slowly diverge

Mitigation:
- require shared authz/services/DTOs for any overlapping inbox/message functionality

---

## 15. Success Criteria

- External callers can authenticate with scoped organization API keys.
- App users continue to authenticate with JWTs.
- Public inbox/message endpoints are read-only and organization-scoped.
- Authorization logic is shared across app and public API paths.
- Public docs are available through OpenAPI and Swagger UI.
- Public route responses are schema-tested to prevent documentation drift.
- The app and public API can evolve independently at the route layer without splitting business logic or policy.
