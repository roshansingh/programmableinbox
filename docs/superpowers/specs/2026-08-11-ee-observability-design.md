# EE Observability: Log Search & OpenTelemetry Tracing

**Date:** 2026-08-11
**Status:** Approved

## Overview

Add structured log search and distributed tracing, available only in the Enterprise Edition / SaaS build — never in the Community Edition. The app ships logs and traces over the standard OpenTelemetry Protocol (OTLP) directly from the running container, with no additional Docker services. Grafana Cloud's free tier is the reference backend (it accepts OTLP for both logs and traces), but nothing in the code is Grafana-specific — any OTLP-compatible collector works.

Off by default even on an EE build. Turning it on requires setting an OTLP endpoint and credentials; there is no bundled/self-hosted Grafana, Loki, or Tempo.

## Scope

- Distributed **traces**: auto-instrumented Next.js API routes and outgoing `fetch`, plus manual spans around webhook email ingest and LLM enrichment
- **Log shipping**: existing Pino JSON logs additionally exported over OTLP, without changing what goes to stdout/`docker logs`
- **Log↔trace correlation**: `trace_id`/`span_id` injected into every log line while a span is active, so Grafana can jump from a trace to its logs
- Gating: build-time (code stripped from FOSS builds) **and** runtime (flag off by default even on EE)

Out of scope for this phase: metrics, self-hosted Grafana/Loki/Tempo as an alternative backend, configurable trace sampling (always-on for now), Prisma query-level spans.

## Gating: build-time + runtime, matching the existing commercial seam

This repo already has a load-bearing distinction between "code that ships in the Community Edition" and "code that only exists in the EE/SaaS build" (see `docs/architecture/commercial-layer.md`): commercial code lives under `ee/`, and `scripts/foss.mjs` deletes `ee/` (and swaps `instrumentation.foss.ts` in for `instrumentation.ts`) to produce a Community build. Observability follows the identical pattern rather than inventing a new one:

- New directory `ee/observability/` holds all the wiring (OTel SDK setup, the Pino OTLP transport). Added to `COMMERCIAL_PATHS` in `scripts/foss.mjs`.
- It is invoked *only* from the root `instrumentation.ts` (the non-FOSS one). `instrumentation.foss.ts` never references it.
- A new config flag, `ENABLE_OBSERVABILITY` (default `false`), lives in the shared `lib/config/schema.ts` — same as every other flag, so `assertConfig()` still validates it uniformly. It is **not** tied to `USE_COMMERCIAL`: a self-hosted EE deployment that isn't running Stripe billing can still turn this on.
- If `ENABLE_OBSERVABILITY=true` is set on a Community build, it is simply inert — nothing calls into `ee/observability/`, so nothing crashes, nothing is exported. This mirrors how `USE_COMMERCIAL=true` behaves on a Community build today.

## Config

New `ObservabilitySchema` in `lib/config/schema.ts`, following the `McpSchema` template (a pure feature toggle) rather than `CommercialSchema` (which also gates a *different* required subsystem):

```typescript
ENABLE_OBSERVABILITY: zBool.optional()        // default false
OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional()
OTEL_EXPORTER_OTLP_HEADERS: z.string().optional()   // e.g. "Authorization=Basic <base64>"
OTEL_SERVICE_NAME: z.string().optional()             // default "inboxui"
```

A `superRefine`, matching `CommercialSchema`'s pattern for Stripe keys, requires `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` whenever `ENABLE_OBSERVABILITY=true` — set-but-incomplete fails `assertConfig()` at boot by name, it does not silently run half-configured. Transforms to `config.observability = { enabled, otlpEndpoint, otlpHeaders, serviceName }`.

These are the standard OTel SDK environment variable names, not Grafana-specific ones. The code never mentions Grafana; only the deployment doc (below) explains how to fill them in for a free Grafana Cloud account. Pointing at self-hosted Grafana, another OTLP collector, or a different vendor entirely is a config change, not a code change.

`.env.example` documents all four as EE-only, consistent with how other conditionally-required vars (`REDIS_URL`, `EMAIL_LINK_SECRET`) are already documented.

## Traces

`ee/observability/init.ts` exports `initializeObservability()`, called from the root `instrumentation.ts`'s `register()` export when `config.observability.enabled`. Uses `@vercel/otel`'s `registerOTel()` — the officially supported Next.js integration point for this hook — configured with an OTLP trace exporter pointed at `config.observability.otlpEndpoint`.

This auto-instruments every API route handler and outgoing `fetch` call with no per-route code. On top of the automatic coverage, two paths get manual spans because they're the ones this codebase has already flagged as complex and prone to drifting out of sync (see `docs/superpowers/specs/*-async-webhook-processing-design.md` and the sync/async parity note in project memory):

- Webhook email ingest (`app/api/webhooks/email/route.ts` and the async worker path)
- LLM enrichment calls

No sampling in this phase — every trace is exported. If a deployment approaches Grafana Cloud's free-tier ingestion cap, the fix in phase 2 is a sampling ratio env var; it is not built now.

**Build note:** `next.config.mjs` needs `@opentelemetry/*` and `@vercel/otel` added to `serverExternalPackages`, the same category of fix already applied for `thread-stream` (see *Build System* in `CLAUDE.md`) — these packages ship non-JS artifacts that break Turbopack/Webpack bundling if inlined.

## Logs + trace correlation

Two independent, additive pieces — one lives in shared code because it's inert without the SDK, the other is EE-only:

**Correlation (shared, `lib/logger.ts`).** A Pino `mixin` calls `@opentelemetry/api`'s `trace.getSpan(context.active())` and, if a span is active, injects `trace_id`/`span_id` into that log line. This uses only the OTel *API* package (not the SDK) — with no SDK registered, `getSpan` returns `undefined` immediately, so this is a no-op on both the Community build and an EE build with the flag off. It does not require gating.

**Shipping (EE-only, `ee/observability/pino-otel-transport.ts`).** `lib/logger.config.ts` conditionally adds an additional Pino transport target — a `pino-opentelemetry-transport`-style worker-thread transport that converts Pino JSON lines into OTel LogRecords and exports them via OTLP to `config.observability.otlpEndpoint` — when `config.observability.enabled`. This runs *alongside* the existing stdout JSON target, not instead of it: `docker logs` output is unchanged either way, so this is additive and low-risk to turn on in an existing deployment.

## Deployment

No new Docker services or Compose profiles. `deploy/docker-compose.yml`'s existing `app` service gains the four new env vars, sourced from the same `env_file: /srv/inboxui/secrets/app.env` mechanism every other secret already uses. A short section is added to the deployment doc explaining how to create a free Grafana Cloud account and get an OTLP endpoint + API key.

## Testing

- `lib/config/__tests__/*`: `ObservabilitySchema` validates the flag-off case (all four vars unset → disabled, no error), the flag-on-complete case, and the flag-on-incomplete case (missing endpoint or headers → `assertConfig()` throws naming the variable) — following the existing pattern for `McpSchema`/`CommercialSchema` tests.
- `lib/logger.ts` mixin: a unit test asserts `trace_id`/`span_id` are absent from a log line with no active span, and present (matching a manually-created test span's IDs) when one is active — no OTel SDK needed for this test, just the API package.
- `scripts/foss.mjs`: extend `scripts/__tests__/foss.test.ts`, which already asserts `COMMERCIAL_PATHS` stripping, to cover `ee/observability/` as well.
- No integration test against a real Grafana Cloud account; the OTLP exporters are third-party SDK code being configured, not logic this repo owns.

## Rollout

Setting `ENABLE_OBSERVABILITY=false` (or leaving it unset) fully disables the feature with zero behavioral change to logging or request handling — safe default, safe rollback. Because log shipping is additive to the existing stdout output and traces are a new signal with no existing consumer, there is no migration and no data to backfill.
