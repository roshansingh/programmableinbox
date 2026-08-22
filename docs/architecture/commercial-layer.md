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
| `CommercialProvider.metering` (`IMetering`) | `NoopMetering` — discards | still the OSS no-op; usage-based billing has no consumer yet, and `IMetering` is deliberately allowed to drop writes, which is why it can never be what enforcement reads |

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

## Billing (Stripe)

Live only when `USE_COMMERCIAL=true`. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are then
**required and asserted at boot** — a deployment that enforces plans but cannot sell anything
should fail loudly rather than 500 at the payment step. Both are `Secret`-boxed.

There is no publishable key: hosted Checkout returns a `session.url` and the browser is redirected
to it, so Stripe.js never loads.

| Route | Purpose |
|---|---|
| `POST /api/app/billing/checkout` | Starts a Checkout session; returns the URL to redirect to |
| `POST /api/app/billing/portal` | Opens Stripe's Billing Portal — card changes, invoices, cancellation |
| `POST /api/webhooks/stripe` | Subscription lifecycle |

All three live in `(ee)` route groups (`app/api/app/(ee)/…`, `app/api/webhooks/(ee)/…`). App Router
routes cannot live under `ee/` — routing is by file position — so the route group is how a
commercial route stays strippable. `scripts/foss.mjs` removes them, which means a FOSS build has no
billing endpoints at all.

**The price is always resolved server-side** from `Plan.stripePriceId`, keyed by the plan `code` the
client sends. A client-supplied price id would let anyone subscribe an organization to a price they
created in their own Stripe account. Checkout is owner/admin-only, and its return URLs come from
`APP_BASE_URL`, never the request `Host`.

Cancellation and card changes go through Stripe's portal rather than routes here. Rebuilding those
means rebuilding SCA, dunning, proration, and tax receipts — and getting each subtly wrong. It also
defaults to end-of-period cancellation, which is what keeps a downgrade landing on the billing
boundary where the usage counter rolls over anyway.

### The webhook

Authenticated by signature over the **raw** body, like the Resend ingest — `constructEvent` verifies
against the exact bytes Stripe sent, so a re-serialised object fails even when identical.

Three properties it has to have, because Stripe guarantees none of them:

- **Replay is normal.** Every write is an upsert or delete keyed on the organization, so a
  redelivered event produces the same end state. There is no seen-events table.
- **Delivery is unordered.** A `subscription.updated` can arrive before the
  `checkout.session.completed` that created it. The subscription object carries its own current
  state, so nothing infers a sequence.
- **Unknown event types return 200.** A 4xx makes Stripe retry the same unhandleable event until it
  disables the endpoint — taking every *other* event down with it. The only non-2xx are a failed
  signature (400) and a genuine internal fault (500), where a retry is what you want.

Stripe's eight subscription statuses narrow onto the four in `SubscriptionStatus`, and **anything
unrecognised maps to `canceled`**. Stripe can add statuses without asking, and the failure mode of
guessing the other way is serving paid limits to someone who is not paying.

### `past_due` keeps its paid limits

Entitlement follows `Subscription.status`, and `past_due` is deliberately entitled.

Stripe retries a failed card on its own schedule for roughly three weeks. Dropping a customer to
`free` on the first decline would stop their mail over an expired card — and on a plan whose
`overQuotaBehavior` is `drop`, destroy it. Entitlement ends when Stripe gives up and the webhook
deletes the subscription, not when a charge bounces.

A terminal status **deletes** the row rather than storing `canceled`: the resolver falls back to
`free` on *absence*, so a row left behind by a missed event would otherwise keep serving paid
limits.

### `sk_live_` is a shared prefix

`API_KEY_PREFIX` (`lib/api-key-scopes.ts`) is literally `sk_live_` — the same prefix Stripe uses for
live secret keys. The two are told apart by shape, not prefix:

| | Format |
|---|---|
| ours | `sk_live_` + exactly 48 **lowercase hex** |
| Stripe | `sk_live_` + 24–107 **base62**, mixed case in practice |

`.gitleaks.toml` encodes exactly that: the Stripe rules require an uppercase letter, which our
format cannot contain, and ours requires 48 lowercase hex, which a Stripe key effectively never is.
Neither rule can fire on the other's keys.

### Local development

```bash
# 1. Point the pro plan at a test-mode recurring price
#    UPDATE plans SET "stripePriceId" = 'price_...' WHERE code = 'pro';

# 2. Forward webhooks; this prints the STRIPE_WEBHOOK_SECRET to use
stripe listen --forward-to localhost:4000/api/webhooks/stripe

# 3. Trigger events without paying
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```

### The dashboard billing page

`/billing` (`app/billing/page.tsx`) is the plan picker — two cards, Free and Pro, each showing 5
fields: email inboxes, incoming emails/month, outbound email, AI enrichment, and price. That cap is
deliberate — the page is meant to be a glance, not a spec sheet, so it shows only what actually
differs between the two plans today rather than every key in `PlanLimits`.

Its data comes from `GET /api/app/billing/plans`, a fourth billing route alongside
checkout/portal/webhook, also under the `(ee)` group. Unlike checkout and portal it is **not**
restricted to `BILLING_ROLES` — reading what a plan costs and includes does not spend anyone's
money, so any member can see it. It queries the `isPublic` `Plan` rows and resolves each one's price
live from Stripe via `stripePriceId` (Plan carries no price column of its own). A plan with no
`stripePriceId` and a Stripe lookup failure both collapse to `price: null`, which the client cannot
and does not need to tell apart — either way there's nothing to charge and nothing to show. That
degrade-per-plan behavior also means one Stripe outage reports one plan as unavailable rather than
failing the whole list.

**There is no downgrade route, on purpose.** The Free card never offers an action when it isn't the
organization's current plan — the only way back to Free is cancelling the Pro subscription, and that
button lives on the Pro card and opens the Billing Portal (`createBillingPortalSession`), exactly
like the settings-page flow it replaces. A dedicated "switch to Free" endpoint would duplicate the
cancellation logic the [Local development](#local-development) section above already argues against
rebuilding — Stripe's portal is where cancellation happens, and the existing webhook
(`customer.subscription.deleted` → `syncSubscriptionFromStripe`) is what actually moves the
organization back to `free` once the subscription ends.

The nav link to it (`components/sidebar.tsx`, `components/mobile-sidebar.tsx`) is gated on
`useAuth().plan` being non-null — no separate `AppConfig` flag was added, because a plan is present
exactly when `USE_COMMERCIAL=true` *and* Stripe is configured: `assertConfig()` refuses to boot
otherwise (see "Billing (Stripe)" above). One check on `plan` is the whole gate.

`success_url` / `cancel_url` (checkout) and `return_url` (portal) all point back at `/billing` now,
not `/settings` — this page is billing's actual home in the dashboard.

## What the client sees

- **Plan limits** ride `organizations[]` on `GET /api/app/auth/me`, via
  `resolveOrganizationPlans()` (`lib/commercial/org-plan.ts`) — deliberately *not* on `AppConfig`,
  which is deployment-scoped and identical for every user, whereas a plan is tenant-scoped. With
  `USE_COMMERCIAL` off this resolves to an empty map at no per-membership cost, which the client
  reads as "no restrictions."
- **Live usage** is a separate, polled endpoint, `GET /api/app/usage` — plan limits change rarely
  and are fine to cache with the session; usage changes constantly and would go stale immediately
  if it rode the same fetch.
- **The plan picker** is `GET /api/app/billing/plans` — see "The dashboard billing page" above.

## Related

- [configuration.md](configuration.md) — where `USE_COMMERCIAL` and other flags are validated
