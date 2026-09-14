# Proposal: environment variable naming convention

Status: **implemented**. The "Before → after" table below is the historical record of what
changed and why — it is intentionally left as originally written (old name → new name) rather than
updated to read old name → old name after the rename landed.

Scope: `.env.example` (there is no `.env.sample` in this repo — that's the file this proposal
analyzed). The renames landed in `lib/config/schema.ts` (the `vars` list per domain, which
`lib/config/schema.ts`'s `DOMAIN_SCHEMAS` registry treats as authoritative), `.env.test.example`,
`.env.quickstart.example`, deploy env files, `CLAUDE.md`, `README.md`, `docs/architecture/**`,
`website/docs/**`, and every other file referencing these names — see "Scope of the change" at the
end for the full list. This was a breaking rename with no aliasing/back-compat layer, by design.
Excluded on purpose: historical/checksummed files (`prisma/migrations/**/migration.sql`) and
point-in-time design docs (`docs/superpowers/plans/**`, `docs/superpowers/specs/**`), which
describe decisions as they stood on their own dates rather than current state.

## Why current names don't hold up

**1. Four different spellings for "boolean feature flag."**
`ENABLE_ASYNC_WEBHOOK_PROCESSING`, `ENABLE_EMAIL_VERIFICATION`, `ENABLE_MCP`,
`ENABLE_OBSERVABILITY`, `ENABLE_PRODUCT_ANALYTICS` use an `ENABLE_` prefix. `USE_COMMERCIAL` uses a
different verb entirely. `AUTH_RATE_LIMIT_ENABLED` and `WEBHOOK_ALLOW_PRIVATE_NETWORK` put the
switch mid-name or at the end. Nothing tells you which pattern a new flag should follow, and
prefix-style flags (`ENABLE_MCP`) don't sort next to the rest of their own subsystem's variables
(`MCP_ALLOWED_ORIGINS`, `MCP_RATE_LIMIT_MAX`).

**2. A prefix that actively lies about its domain — confirmed, not just stylistic.**
`AUTH_RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `AUTH_EMAIL_FROM_NAME` read as "the email config
used for auth." Checking the call sites:

```
lib/automations/actions.ts
lib/email/password-reset-email.ts
lib/email/verification-email.ts
app/api/app/emailInbox/[id]/send/route.ts
app/api/webhooks/email/route.ts
```

This is the general transactional-email provider config — used by automation actions and manual
inbox replies, not just auth flows. Tellingly, `lib/config/schema.ts` already names the internal
Zod schema `EmailSchema`, not `AuthSchema` — the code's own internal naming disagrees with the env
var prefix. Of the three, `AUTH_RESEND_API_KEY` is renamed below; `AUTH_EMAIL_FROM` and
`AUTH_EMAIL_FROM_NAME` are left as-is per explicit direction, so the `AUTH_` mislabeling stands for
those two.

**3. Domain grouping is inconsistent elsewhere too — and one variable is vendor-specific inside a
generic schema.**
`MCP_*`, `OTEL_*`, `POSTHOG_*`, and `STRIPE_*` group cleanly under one prefix each. Webhook config
mostly does too, but `lib/config/schema.ts` shows one sharp edge inside `WebhooksSchema`:
`WEBHOOK_SECRET` verifies the signature on Resend's specific inbound push (Svix-based, per the
current comment) — genuinely vendor-specific — while `WEBHOOK_QUEUE_MAX_RETRIES` and
`WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` tune the generic async job queue that processes
webhook jobs regardless of source, and is meant to be reused as more webhook processing is added.
Only the first of those three should carry a vendor prefix.

Separately, `SecuritySchema` — `WEBHOOK_EGRESS_ALLOWLIST`, `WEBHOOK_ALLOW_PRIVATE_NETWORK` — is an
unrelated feature that happens to share the `WEBHOOK_` prefix: the SSRF guard on the automations
engine's **outbound** `send_webhook` action, sending to tenant-supplied URLs, as opposed to the
**inbound** processing the other three variables configure. The second-level word (`QUEUE` vs.
`EGRESS`) already disambiguates that split reasonably, so both can keep the shared `WEBHOOK_`
prefix.

Its own on/off switch, `ENABLE_ASYNC_WEBHOOK_PROCESSING`, additionally breaks the boolean pattern
and sorts under `E`, nowhere near either cluster.

**4. Three incompatible unit-naming styles.**
`_S` (`AUTH_LOCKOUT_BASE_S`, `*_WINDOW_S`), `_MS` (`RATE_LIMIT_TIMEOUT_MS`), and fully spelled
`_MINUTES` (`EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`) all appear. A reader has to already know the
specific variable to know which abbreviation style it uses.

**5. Bare `_MAX` doesn't say what's being capped.**
`AUTH_RATE_LIMIT_LOGIN_IP_MAX` caps a request count, `AUTH_LOCKOUT_MAX_S` caps a duration,
`WEBHOOK_QUEUE_MAX_RETRIES` caps a retry count — three different quantities, disambiguated only by
an inconsistent (or absent) suffix.

**6. `_SECRET` vs. `_KEY` is an accident, not a rule.**
Elsewhere, `_SECRET` means "a value we use to sign/verify something we issued"
(`JWT_SECRET`, `WEBHOOK_SECRET`, `EMAIL_LINK_SECRET`) and `_KEY` means "a credential handed to a
third-party API" (`LLM_API_KEY`, `POSTHOG_API_KEY`). `STRIPE_SECRET_KEY` is Stripe's own vocabulary
leaking through, and breaks the local pattern — it's a `_KEY` we send *to* Stripe, not a secret we
use to verify something ourselves.

**7. The worst offender: two variables one word apart, doing unrelated things.**
`OTEL_EXPORTER_OTLP_ENDPOINT` is read by the app's own OTel SDK and points at the local
`otel-collector` sidecar. `OTEL_EXPORTER_ENDPOINT` is never read by the app at all — it's the
collector container's own config for the real backend, and lives in a separate secrets file. They
differ by one token in the middle. A typo between them silently misroutes telemetry with no error.
Left unchanged below per explicit direction — this remains the sharpest finding in this document,
but no rename was wanted for this pair.

**8. Ungrouped rate-limit knobs sit next to domain-grouped ones with no signal.**
`AUTH_RATE_LIMIT_*` and `MCP_RATE_LIMIT_*` are domain-specific. `RATE_LIMIT_TIMEOUT_MS` and
`RATE_LIMIT_FAIL_MODE` (no domain segment) are shared infrastructure config consumed by *both*
scopes. Nothing in the name says "this one is global, not auth-only." Left unchanged below per
explicit direction — the observation stands, but no rename was wanted for this pair.

## Proposed convention

1. **Every variable starts with its subsystem**: `AUTH_`, `EMAIL_`, `WEBHOOK_`, `MCP_`, `OTEL_`,
   `POSTHOG_`, `STRIPE_`, `RESEND_`, `LLM_`, `REDIS_`, `COMMERCIAL_`. `AUTH_` is reserved for actual
   authentication (JWT, login/registration throttling, lockout); email sending moves to
   `EMAIL_`/`RESEND_`. `DATABASE_URL`/`MIGRATE_DATABASE_URL` and `RATE_LIMIT_TIMEOUT_MS` /
   `RATE_LIMIT_FAIL_MODE` are deliberate exceptions — see "Not renamed" below.
2. **Booleans are always `<...>_ENABLED`** — suffix, never prefix, no exceptions (`MCP_ENABLED`,
   `OBSERVABILITY_ENABLED`, `COMMERCIAL_ENABLED`, `ASYNC_WEBHOOK_PROCESSING_ENABLED`). The
   segment(s) before `_ENABLED` don't have to be a single domain word when the flag is
   intentionally generic — see `ASYNC_WEBHOOK_PROCESSING_ENABLED` below.
3. **Time units are spelled out in full, always**: `_SECONDS`, `_MINUTES`, `_MILLISECONDS`. No
   abbreviations — one rule instead of three.
4. **A capped quantity names the thing being capped**, never just "MAX": `_MAX_REQUESTS`,
   `_MAX_ATTEMPTS`, `_MAX_RETRIES`.
5. **`_SECRET`** verifies something we issued (HMAC/JWT signing, webhook signatures).
   **`_API_KEY`** is a credential sent to a third party. Applied without exception, including
   `STRIPE_API_KEY`.
6. **Domain leads even for rate limiting.** Per-domain limits keep their domain's prefix in front
   — `AUTH_RATE_LIMIT_*`, `MCP_RATE_LIMIT_*` — per explicit direction: these are specific to auth
   and to MCP respectively, and should read that way first. `RATE_LIMIT_TIMEOUT_MS` and
   `RATE_LIMIT_FAIL_MODE` have no single domain owner (both auth and MCP rate limiting share them)
   and are left unchanged per explicit direction rather than assigned a prefix.
7. ~~The collector-only OTel pair is renamed off the SDK-standard name, so it can never be confused
   with the real standard vars.~~ Proposed, but `OTEL_EXPORTER_ENDPOINT` / `OTEL_EXPORTER_AUTH` are
   left unchanged per explicit direction — see item 7 above and "Not renamed" below.
8. **A third-party integration is prefixed by the vendor's name, not a generic domain word** —
   matching the `STRIPE_*` / `POSTHOG_*` convention already in this file: `RESEND_*`, not
   `EMAIL_PROVIDER_*`. This applies only to what's genuinely tied to that vendor's own API/scheme
   (Resend's API key, Resend's Svix-signed webhook secret) — infrastructure that's meant to be
   reused regardless of vendor (the async job queue and its enable flag) stays generic, and
   `AUTH_EMAIL_FROM` / `AUTH_EMAIL_FROM_NAME` are left untouched per explicit direction rather than
   folded into either `EMAIL_*` or `RESEND_*`.

## Before → after

| Current | Proposed | Why |
|---|---|---|
| `DATABASE_URL` | *(unchanged)* | kept as-is — matches Prisma's/the ecosystem's own convention for this exact name |
| `MIGRATE_DATABASE_URL` | *(unchanged)* | kept as-is — already reads clearly next to `DATABASE_URL` |
| `JWT_SECRET` | `AUTH_JWT_SECRET` | groups with other `AUTH_*` |
| `AUTH_RESEND_API_KEY` | `RESEND_API_KEY` | not auth-specific — confirmed by call sites above; vendor-prefixed like `STRIPE_*`/`POSTHOG_*` |
| `WEBHOOK_SECRET` | `RESEND_WEBHOOK_SECRET` | it's specifically Resend's (Svix) inbound webhook signature — vendor-specific, unlike the queue/enable vars below which are meant to be reused across webhook sources |
| `AUTH_EMAIL_FROM` | *(unchanged, per user)* | kept as-is |
| `AUTH_EMAIL_FROM_NAME` | *(unchanged, per user)* | kept as-is |
| `EMAIL_INBOX_DOMAINS` | `EMAIL_INBOX_ALLOWED_DOMAINS` | "allowed" makes the allowlist semantics explicit |
| `ENABLE_ASYNC_WEBHOOK_PROCESSING` | `ASYNC_WEBHOOK_PROCESSING_ENABLED` | boolean rule (suffix `_ENABLED`); stays generic — per user, this flag is meant to be reused for webhook processing beyond Resend, not vendor-prefixed |
| `REDIS_URL` | `REDIS_URL` | already fine |
| `WEBHOOK_QUEUE_MAX_RETRIES` | `WEBHOOK_QUEUE_MAX_ATTEMPTS` | stays generic, same reasoning as the enable flag above — this is the async job queue, not Resend-specific; "attempts" avoids the off-by-one confusion the current comment has to spell out |
| `WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX` | `WEBHOOK_QUEUE_CONCURRENCY_PER_INBOX` | stays generic; drops redundant "WORKER" |
| `AUTH_RATE_LIMIT_ENABLED` | *(unchanged)* | already satisfies both rules: `AUTH_` prefix in front, `_ENABLED` suffix — per user, stays under `AUTH_`, not moved to `RATELIMIT_AUTH_*` |
| `AUTH_RATE_LIMIT_LOGIN_IP_MAX` / `_WINDOW_S` | `AUTH_RATE_LIMIT_LOGIN_IP_MAX_REQUESTS` / `AUTH_RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS` | keeps `AUTH_` leading; names the capped quantity + spells the unit |
| `AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX` / `_WINDOW_S` | `AUTH_RATE_LIMIT_LOGIN_ACCOUNT_MAX_REQUESTS` / `AUTH_RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS` | same |
| `AUTH_RATE_LIMIT_REGISTER_IP_MAX` / `_WINDOW_S` | `AUTH_RATE_LIMIT_REGISTER_IP_MAX_REQUESTS` / `AUTH_RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS` | same |
| `AUTH_RATE_LIMIT_REGISTER_ACCOUNT_MAX` / `_WINDOW_S` | `AUTH_RATE_LIMIT_REGISTER_ACCOUNT_MAX_REQUESTS` / `AUTH_RATE_LIMIT_REGISTER_ACCOUNT_WINDOW_SECONDS` | same |
| `AUTH_LOCKOUT_THRESHOLD` | `AUTH_LOCKOUT_MAX_FAILURES` | keeps `AUTH_` leading (lockout is auth-specific); names what's capped |
| `AUTH_LOCKOUT_BASE_S` | `AUTH_LOCKOUT_BASE_SECONDS` | spelled unit |
| `AUTH_LOCKOUT_MAX_S` | `AUTH_LOCKOUT_MAX_SECONDS` | spelled unit |
| `AUTH_LOCKOUT_FAILURE_WINDOW_S` | `AUTH_LOCKOUT_FAILURE_WINDOW_SECONDS` | spelled unit |
| `RATE_LIMIT_TIMEOUT_MS` | *(unchanged, per user)* | kept as-is; no single domain owns it |
| `RATE_LIMIT_FAIL_MODE` | *(unchanged, per user)* | kept as-is; no single domain owns it |
| `TRUSTED_PROXY_COUNT` | `AUTH_TRUSTED_PROXY_COUNT` | only affects `getClientIp` for rate limiting |
| `LOG_LEVEL` | `LOG_LEVEL` | already fine |
| `HEALTHZ_SECRET` | `HEALTHZ_DETAIL_SECRET` | clarifies it gates the *detail* block only |
| `AUTOMATION_SWEEPER_SECRET` | `AUTOMATION_SWEEPER_SECRET` | already fine |
| `WEBHOOK_EGRESS_ALLOWLIST` | `WEBHOOK_EGRESS_ALLOWED_HOSTS` | matches "allowed" convention above |
| `WEBHOOK_ALLOW_PRIVATE_NETWORK` | `WEBHOOK_EGRESS_ALLOW_PRIVATE_NETWORK` | groups with the other egress knob |
| `ENABLE_EMAIL_VERIFICATION` | `EMAIL_VERIFICATION_ENABLED` | boolean rule |
| `EMAIL_LINK_SECRET` | `EMAIL_LINK_SIGNING_SECRET` | consistent with `RESEND_WEBHOOK_SECRET`'s and `STRIPE_WEBHOOK_SIGNING_SECRET`'s explicit "what this verifies" naming |
| `APP_BASE_URL` | `APP_BASE_URL` | already fine |
| `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` | `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES` | already fine (unit already spelled out) |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `AUTH_PASSWORD_RESET_TOKEN_TTL_MINUTES` | groups with `AUTH_*`, distinguishes from the email-verification TTL at a glance |
| `USE_COMMERCIAL` | `COMMERCIAL_ENABLED` | boolean rule |
| `STRIPE_SECRET_KEY` | `STRIPE_API_KEY` | `_KEY` / `_SECRET` rule |
| `STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SIGNING_SECRET` | consistent signing-secret naming |
| `ENABLE_MCP` | `MCP_ENABLED` | boolean rule |
| `MCP_ALLOWED_ORIGINS` | `MCP_ALLOWED_ORIGINS` | already fine |
| `MCP_RATE_LIMIT_MAX` / `_WINDOW_S` | `MCP_RATE_LIMIT_MAX_REQUESTS` / `MCP_RATE_LIMIT_WINDOW_SECONDS` | keeps `MCP_` leading, same domain-first rule applied to the auth rate limits above |
| `ENABLE_OBSERVABILITY` | `OBSERVABILITY_ENABLED` | boolean rule |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(unchanged)* | standard OTel SDK var — external constraint, cannot rename |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | *(unchanged)* | same |
| `OTEL_EXPORTER_OTLP_HEADERS` | *(unchanged)* | same |
| `OTEL_SERVICE_NAME` | *(unchanged)* | same |
| `ENABLE_PRODUCT_ANALYTICS` | `PRODUCT_ANALYTICS_ENABLED` | boolean rule |
| `POSTHOG_API_KEY` | *(unchanged)* | already fine |
| `POSTHOG_HOST` | *(unchanged)* | already fine |
| `OTEL_EXPORTER_ENDPOINT` | *(unchanged, per user)* | kept as-is — see item 7 above; the near-collision with `OTEL_EXPORTER_OTLP_ENDPOINT` stands |
| `OTEL_EXPORTER_AUTH` | *(unchanged, per user)* | kept as-is, same caveat |

**Not renamed:**
- `DATABASE_URL`, `MIGRATE_DATABASE_URL` — kept as-is at the user's request.
- `RATE_LIMIT_TIMEOUT_MS`, `RATE_LIMIT_FAIL_MODE` — kept as-is at the user's request. Along with
  the pair above, these are the variables left without a domain prefix under this convention.
- `OTEL_EXPORTER_ENDPOINT`, `OTEL_EXPORTER_AUTH` — kept as-is at the user's request, despite being
  flagged as the single sharpest finding in this document (item 7 above): a one-word difference
  from `OTEL_EXPORTER_OTLP_ENDPOINT`, an unrelated, app-read standard OTel SDK variable.
- `NEXT_PUBLIC_API_MODE` — Next.js's own convention; the `NEXT_PUBLIC_` prefix can't change.
- `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` — already domain-grouped and clear.

## Scope of the change

This was a breaking rename with no back-compat aliasing layer — a deployment still setting an old
name now fails `assertConfig()` at boot naming the new variable, the same pattern this codebase
already used for `EMAIL_VERIFICATION_SECRET` → `EMAIL_LINK_SECRET` (itself since renamed again to
`EMAIL_LINK_SIGNING_SECRET` by this proposal) and `ENABLE_BILLING` → `USE_COMMERCIAL` (itself since
renamed to `COMMERCIAL_ENABLED`). Files that changed:

- `lib/config/schema.ts` — the `vars` list per domain (authoritative source; `assertConfig()` and
  the `.env.example` coverage test both derive from it)
- `.env.example`, `.env.test.example`, `.env.quickstart.example`
- `test/config.ts`, `vitest.config.ts` (the shared test-suite config baseline)
- `test/integration/setup/setup.ts` (hardcodes several of these as boot fixtures)
- Deploy env files (`docker-compose.yml`, `deploy/docker-compose.yml`)
- Docs under `docs/architecture/` that name specific variables
- `CLAUDE.md` (root), `README.md`, `PRD.md`, and `website/docs/**` — every user- or
  operator-facing doc that named one of these variables
- `prisma/schema.prisma` comments (`lib/generated/prisma/**` regenerated from it, not hand-edited)

Deliberately left untouched: `prisma/migrations/**/migration.sql` (historical, checksum-tracked —
rewriting a comment in an already-applied migration would change its checksum and break
`prisma migrate deploy` on an existing database) and `docs/superpowers/plans/**` /
`docs/superpowers/specs/**` (point-in-time design docs describing decisions as they stood on their
own dates).

Verified: full test suite green (172 files, 2277 passed, 2 skipped — same as the pre-rename
baseline), lint clean, typecheck clean.
