# API Integration Test Suite — Design

**Date:** 2026-07-20
**Branch:** `api-integration-tests` (off `origin/main` @ `b3c7336`, which includes the UUIDv7 migration #76 but **not** the timezone fix #75)
**Status:** Design — awaiting review

---

## 1. Goal

A comprehensive integration test suite covering **all 34 API route handlers**, exercising each against a **real Postgres database** with **no mocks** for `@/lib/db` or auth. The suite runs **separately** from the existing 450 mocked unit tests, and **cleans up every resource** it creates on teardown.

The existing unit tests mock Prisma, so they cannot catch SQL-, schema-, or serialization-level bugs — the exact class that the recently-found `::uuid` cast and timezone bugs belong to. This suite closes that gap.

---

## 2. Execution model

Import each route's exported handlers (`GET`/`POST`/`PATCH`/`DELETE`) and invoke them directly with a real `NextRequest`, letting them run against a real database through the unmodified `lib/db` singleton.

```ts
import { POST } from '@/app/api/v1/apiKeys/route'

const { org, token } = await createOrgWithUser()
const res = await POST(authed(
  new NextRequest('http://localhost/api/v1/apiKeys', {
    method: 'POST',
    body: JSON.stringify({ name: 'CI', scopes: ['messages:read'], organizationId: org.id }),
  }),
  token,
))
expect(res.status).toBe(201)

// Assert real persisted state, not a mock's echo:
const row = await prisma.apiKey.findFirstOrThrow({ where: { organizationId: org.id } })
expect(row.keyHash).not.toBeNull()
expect(row.apiKey).toBeNull()          // raw key is never stored
```

Every assertion checks **both** the HTTP response and the resulting DB state. Dynamic-route handlers receive `{ params: Promise.resolve({ id }) }` per the Next.js 16 async-params convention.

**Not chosen:** booting a live `next start` server and hitting it over HTTP. More faithful, far heavier (build + server lifecycle + port management + much slower), and unnecessary to exercise route logic against real SQL. Recorded so it isn't re-litigated.

---

## 3. Test database lifecycle & safety

### Provisioning
- A dedicated `inbox_test` database on the local Postgres, addressed by a required `TEST_DATABASE_URL` env var.
- **Global setup** (once per run): create `inbox_test` if absent (connecting to the `postgres` maintenance DB), then `prisma migrate deploy` against it. This applies the same baseline migration as production, including the hand-written `pgcrypto` extension and partial indexes.
- The integration vitest config sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` in a setup file that runs **before** any test module imports `@/lib/db`, so the singleton connects to the test DB.

### Safety guard (non-negotiable)
Before any truncation or migration, setup asserts the target database name matches `/test/i`. If `TEST_DATABASE_URL` is unset, or its database name does not look like a test DB, setup **throws and aborts**. Accidentally truncating the dev or prod database is the single catastrophic failure mode; this guard makes it structurally impossible.

### Per-test isolation
`beforeEach`: `TRUNCATE <every table> RESTART IDENTITY CASCADE` in one statement. Fast, total, order-independent. The table list is derived once from `information_schema` (excluding `_prisma_migrations`) so new models are picked up automatically.

### Serial execution
Integration files run **serially** — `fileParallelism: false`, single fork (`pool: 'forks'`, `poolOptions.forks.singleFork: true`). All files share one `inbox_test`, so a per-test `TRUNCATE` in parallel workers would race. Serial is correct-first and deterministic. If runtime becomes a problem later, the escape hatch is per-worker databases (`inbox_test_${VITEST_WORKER_ID}`); explicitly out of scope for v1.

### Teardown — "clean up all resources"
- `afterAll` (per file): final `TRUNCATE` + `prisma.$disconnect()`.
- **Global teardown** (end of run): `DROP DATABASE inbox_test` so nothing persists between runs. Overridable with `KEEP_TEST_DB=1` when a developer wants to inspect state after a failure.
- Any external side effects (BullMQ/Redis enqueues, outbound email) are already disabled in tests: `ENABLE_ASYNC_WEBHOOK_PROCESSING` stays unset (synchronous path), and email/Resend calls are stubbed at the module boundary — the DB is the system under test, not third-party services.

---

## 4. Auth & fixture helpers

Location: `test/integration/helpers/`.

| Helper | Produces | Used for |
|---|---|---|
| `createOrgWithUser(opts?)` | real `User` + `Organization` + `Membership` (default role `owner`), returns `{ user, org, membership, token }` where `token` is a genuine JWT from `signToken` | JWT-authed endpoints |
| `createApiKey(orgId, scopes)` | real `ApiKey` row hashed via `lib/api-key-security`, returns the raw `sk_live_…` string (shown once) | API-key-authed endpoints, **per organization** |
| `authed(req, credential)` | same `NextRequest` with `Authorization: Bearer <credential>` | attaching either credential type |
| `signWebhook(payload)` | `{ headers, body }` with a valid HMAC `x-webhook-signature` + `x-webhook-timestamp` over `WEBHOOK_SECRET` | `POST /api/v1/webhooks/email` |
| `cronAuth()` | header/bearer carrying `AUTOMATION_SWEEPER_SECRET` | `POST /api/cron/sweep-stuck-runs` |
| `seedInbox`, `seedMessage`, `seedAutomation`, … | resource factories writing valid rows directly via Prisma | arranging preconditions without going through the API |

Required test env (set in the integration config, documented in `.env.test.example`): `TEST_DATABASE_URL`, `JWT_SECRET`, `WEBHOOK_SECRET`, `AUTOMATION_SWEEPER_SECRET`, `HEALTHZ_SECRET`, `NEXT_PUBLIC_API_MODE=local`.

---

## 5. Coverage — all 34 endpoints, tiered

Every endpoint gets, at minimum: **(a)** rejects missing/invalid auth with the correct status, and **(b)** one happy-path success asserting DB state.

CRUD resources additionally get: full **create → read → update → delete** round trips, **validation `400`s**, and **cross-tenant isolation** (org B must not read/mutate org A's rows — expect `404`/`403`). Cross-tenant isolation is the highest-value category; it is where real multi-tenancy bugs hide.

### Auth & account
| Endpoint | Methods | Notable cases |
|---|---|---|
| `auth/register` | POST | creates user+hash; duplicate email `409`; weak/invalid input `400`; returns JWT |
| `auth/login` | POST | valid creds → JWT; wrong password `401`; unknown email `401` |
| `auth/me` | GET | valid token → user; no/expired token `401` |
| `v1/account/organization` | PATCH | rename own org; non-member org `403/404` |
| `v1/account/password` | PATCH | change with correct current pw; wrong current pw `400/401` |

### API keys
| `v1/apiKeys` | GET, POST | create returns raw key once; list exposes only `prefix`+`scopes`, never hash/raw; invalid scope `400`; cross-tenant list isolation |
| `v1/apiKeys/[id]` | GET, DELETE | fetch own; delete (revoke) own; other org's key `404` |

### Email inboxes & messages
| `v1/emailInbox` | GET, POST | create; duplicate global address `409`; list scoped to org |
| `v1/emailInbox/[id]` | GET, PATCH, DELETE | CRUD; soft-delete semantics; cross-tenant `404` |
| `v1/emailInbox/[id]/messages` | GET | list + cursor pagination; **grouped/threaded mode** (exercises the raw-SQL `DISTINCT ON` + cursor — the timezone-sensitive path) |
| `v1/emailInbox/[id]/messages/[messageId]` | GET, PATCH, DELETE | fetch; star/update; soft-delete; cross-tenant `404` |
| `v1/emailInbox/[id]/otp` | GET | returns latest extracted OTP; none → empty |
| `v1/emailInbox/[id]/send` | POST | happy path (Resend stubbed); threadId seeding; validation `400` |

### Phone inboxes
| `v1/phoneInbox` | GET, POST | create; list scoped |
| `v1/phoneInbox/[id]` | GET, PATCH, DELETE | CRUD; cross-tenant `404` |

### Webhooks (outbound config)
| `webhooks` | GET, POST | create; list scoped |
| `webhooks/[id]` | GET, PATCH, DELETE | CRUD; cross-tenant `404` |
| `webhooks/[id]/events` | GET | list events for a webhook; scoped |
| `webhooks/[id]/events/[eventId]/retry` | POST | re-enqueue a failed event; wrong owner `404` |
| `webhooks/[id]/test` | POST | test-fire (delivery stubbed) |

### Automations (Tier 3 — happy path + primary branches, engine internals smoke-only)
| `v1/automations` | GET, POST | create with revision; list scoped |
| `v1/automations/[id]` | GET, PATCH, DELETE | CRUD; cross-tenant `404` |
| `v1/automations/[id]/duplicate` | POST | clones automation + active revision |
| `v1/automations/[id]/activate-revision` | POST | sets `activeRevisionId`; bad revision `400/404` |
| `v1/automations/[id]/dry-run` | POST | executes against a sample message without persisting side effects (**smoke**) |
| `v1/automations/[id]/runs` | GET, POST | list runs; trigger a run |
| `v1/automations/[id]/runs/[runId]` | GET | fetch run + node runs |
| `v1/automations/[id]/runs/[runId]/replay` | POST | replays a prior run |

### Stats
| `v1/stats` | GET | returns org-scoped counts (inboxes, messages, …); reflects seeded rows; scoped to caller's org only |

### Inbound & system
| `v1/webhooks/email` | POST | valid HMAC + `email.received` → message persisted; **bad signature `401`**; replay outside window `401`; **threading** (In-Reply-To/References, then subject fallback); duplicate `(externalId, inboxEmailAddressId)` silently skipped |
| `cron/sweep-stuck-runs` | POST | valid secret sweeps stuck runs; wrong/absent secret `401` |
| `internal/webhook-worker/health` | GET | `503`/gated when async disabled; healthy when enabled |
| `healthz` | GET | `200` + `SELECT 1`; secret variant when `HEALTHZ_SECRET` set |
| `docs` | GET | serves OpenAPI JSON, public |

**Honest scope note (no silent capping):** automation dry-run/replay tests assert the run is created and reaches a terminal state with the right shape; they do **not** exhaustively cover every node type, branch, and error policy in the execution engine. That deeper engine coverage is called out as explicitly deferred, not quietly omitted.

**Estimated size:** ~130–160 test cases across ~15 per-resource files.

---

## 6. Bug-fixing policy

Running real SQL will surface real bugs. Known-live on this base:

- **Timezone / grouped pagination** (already fixed in PR #75, not yet merged): the grouped-threads cursor compares a DB-side `extract(epoch …)` against a Prisma-read `Date`; under a non-UTC session they disagree by the offset and page 2 returns empty. The suite's grouped-pagination test will reproduce it.

Policy:
1. When a test surfaces a genuine bug, fix it with a **minimal app-code change** in this branch.
2. If the fix **overlaps an existing open PR** (#75/#76), apply the equivalent fix here and **flag the overlap explicitly** in the PR description so it can be de-duplicated at merge — rather than leaving a known-red test.
3. If a "failure" is actually a test-expectation error, fix the test, not the app.
4. Never weaken an assertion to make a test pass.

The timezone fix specifically will be handled by setting the test connection to UTC (matching #75's approach) so the suite is green, with a note that #75 is the production-facing counterpart.

---

## 7. Separation from unit tests

- **New file `vitest.integration.config.ts`** — `environment: 'node'`, own `setupFiles`, `globalSetup`, serial execution, `include: ['test/integration/**/*.integration.test.ts']`.
- **`vitest.config.ts`** — add `test/integration/**` to `exclude` so `npm test` never runs integration tests.
- **`package.json`**:
  - `test` → unchanged (unit only)
  - `test:integration` → `vitest run --config vitest.integration.config.ts`
  - `test:integration:watch` → watch variant
- **CI**: a separate job/step provisions a `postgres:17` service and runs `npm run test:integration` with `TEST_DATABASE_URL` pointed at it. (CI wiring documented; adding the actual workflow file is in scope only if a CI workflow already exists to extend — otherwise documented for the user to add.)

---

## 8. File layout

```
vitest.integration.config.ts              # new; serial, node env
.env.test.example                         # documents required test env
test/integration/
  setup/
    global-setup.ts                        # create db + migrate deploy (once)
    global-teardown.ts                     # drop db unless KEEP_TEST_DB
    setup.ts                               # per-worker: point DATABASE_URL at test db, safety guard, truncate hooks
  helpers/
    auth.ts                                # createOrgWithUser, createApiKey, authed
    webhook.ts                             # signWebhook, cronAuth
    factories.ts                           # seedInbox/seedMessage/seedAutomation/...
    request.ts                             # NextRequest builders, params helper
  auth.integration.test.ts
  account.integration.test.ts
  api-keys.integration.test.ts
  email-inbox.integration.test.ts
  email-messages.integration.test.ts
  email-send.integration.test.ts
  phone-inbox.integration.test.ts
  webhooks.integration.test.ts
  webhook-events.integration.test.ts
  automations.integration.test.ts
  automation-runs.integration.test.ts
  stats.integration.test.ts                # v1/stats
  inbound-email.integration.test.ts        # v1/webhooks/email (HMAC + threading)
  system.integration.test.ts               # cron, healthz, docs, worker-health
```

---

## 9. Out of scope (explicit)

- Live HTTP server / black-box testing (§2).
- Parallel integration execution / per-worker DBs (§3) — deferred.
- Exhaustive automation-engine node coverage (§5) — deferred.
- Load/performance testing.
- The production-facing timezone fix — that is PR #75; here it is only applied to the test connection so the suite is green.
