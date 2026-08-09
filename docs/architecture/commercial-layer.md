# The commercial layer

ProgrammableInbox is open core: the code in this repository is licensed under AGPL-3.0, with a
carve-out for anything under `ee/` (see the root [LICENSE](../../LICENSE) and
[`ee/README.md`](../../ee/README.md)). This doc describes the seam between the two, not the
license itself.

## The pattern: an injected, swappable provider

`lib/commercial/` defines the plan/quota/metering engine's interfaces, plus the permissive
no-op defaults an open-source, self-hosted build runs with. `ee/` holds the real, DB-backed
implementations. Call sites in `lib/` and `app/` go through `CommercialProvider`, never through a
concrete implementation, so the exact same code path runs whether or not `ee/` is present:

| | OSS default (`lib/commercial/oss/`) | Commercial (`ee/`, wired from `ee/init.ts`) |
|---|---|---|
| `CommercialProvider.plans` (`IPlanResolver`) | `UnlimitedPlanResolver` — returns the `self_hosted` plan, never touches the database | `DbPlanResolver` — resolves `Subscription` → `Plan` from Postgres |
| `CommercialProvider.quota` (`IQuota`) | `NoopQuota` — allows everything, counts nothing | `PostgresQuota` — atomic check-and-consume against a `usage_counters` table |
| `CommercialProvider.metering` (`IMetering`) | `NoopMetering` — discards | still the OSS no-op today; billing telemetry has no consumer until Stripe lands |

`ee/init.ts` is called once at boot, from root `instrumentation.ts`. With `USE_COMMERCIAL=false`
(the default) it returns immediately, without configuring anything — the OSS defaults stand and
the `plans`, `subscriptions`, and `usage_counters` tables are never queried. **Deleting `ee/`
removes the only caller of `CommercialProvider.configure()`**, which is what makes a stripped
build unlimited by construction, not by a flag someone has to remember to set.

`USE_COMMERCIAL` replaced an earlier `ENABLE_BILLING` flag, deliberately without a compatibility
alias — the old name described a narrower thing (payments) than the flag actually gates now, and
a deployment still setting the old name fails `assertConfig()` naming the new variable, rather
than silently starting with enforcement off.

## What's actually enforced

Two different enforcement shapes, because they need different guarantees:

- **Count caps** (`checkResourceLimit`, `lib/commercial/enforce.ts`) — gate *creation*: "you may
  have at most N inboxes / API keys / webhooks / automations / members." A create-time predicate
  only — an organization already over its limit when `USE_COMMERCIAL` is switched on keeps every
  existing resource working; only the *next* create is refused. It's advisory against
  concurrency (two simultaneous creates can both land under the same cap), which is an accepted
  trade-off: the window is milliseconds and the harm is one extra row.
- **Per-period meters** (`IQuota.consume` / `refund` / `peek` / `peekMany`) — for metrics like
  `emails.processed`, `llm.enrichments`, or `api.requests` that accumulate over a billing period.
  These *are* atomic — a single conditional statement against the store, because a
  read-then-write here would let concurrent inbound mail overshoot the cap. `refund` exists so a
  duplicate webhook delivery (rejected by the `(externalId, inboxEmailAddressId)` unique
  constraint) doesn't burn an organization's allowance for work that never actually happened.

Both paths read `Plan.limits`, a Prisma `Json` column validated end-to-end by `PlanLimitsSchema`
(`lib/commercial/plan-limits.ts`) — the schema is the entire contract, since Prisma type-checks
nothing about JSON column contents. Two things about it matter for anyone adding a limit:

- **`null` means unlimited; `0` is a real limit meaning "none allowed."** The two must stay
  distinguishable, so enforcement never treats an unset limit as a hard zero.
- **New fields default permissively.** Adding a key to the schema must not retroactively enforce
  a limit no one chose on every already-seeded `Plan` row; the one exception is
  `overQuotaBehavior`, which defaults to `overage` (allow and keep counting) rather than `drop`
  (discard permanently) for the same reason — a default must never be the irreversible choice.

A refused create returns `402 Payment Required` — not `403` (already used for authorization) or
`429` (already used for rate limiting) — carrying `limit`, `used`, and `planCode` so the client
can render an accurate upsell instead of a bare error.

## What the client sees

- **Plan limits** ride `organizations[]` on `GET /api/app/auth/me`, via
  `resolveOrganizationPlans()` (`lib/commercial/org-plan.ts`) — deliberately *not* on `AppConfig`,
  which is deployment-scoped and identical for every user, whereas a plan is tenant-scoped. With
  `USE_COMMERCIAL` off this resolves to an empty map at no per-membership cost, which the client
  reads as "no restrictions."
- **Live usage** is a separate, polled endpoint, `GET /api/app/usage` — plan limits change rarely
  and are fine to cache with the session; usage changes constantly and would go stale immediately
  if it rode the same fetch.

## Related

- [configuration.md](configuration.md) — where `USE_COMMERCIAL` and other flags are validated
