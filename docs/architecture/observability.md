# Observability: log search & tracing

This doc describes the design of EE/SaaS-only log search and distributed tracing — the seam
between the two, not a how-to. For self-hosted setup, see
[`docs/observability-operator-guide.md`](../observability-operator-guide.md).

## Overview

This ships two things: OpenTelemetry distributed tracing across request handlers and background
jobs, and log shipping to an external backend with trace/log correlation. Both are EE/SaaS-only.
It exports directly over OTLP (OpenTelemetry Protocol) from the running container — there is no
bundled Grafana, Loki, or Tempo, and no sidecar container. An operator points it at whatever
OTLP-compatible backend they already run.

## The gate

Two independent gates, the same shape as the [commercial layer](commercial-layer.md):

- **Build-time**: the wiring lives under `ee/observability/`, which is nested inside the existing
  `ee` entry in `scripts/foss.mjs`'s `COMMERCIAL_PATHS` — no change to that array was needed,
  since `ee` already covers everything below it. A stripped Community build has no
  `ee/observability/` directory at all.
- **Runtime**: `ENABLE_OBSERVABILITY`, default `false`, independent of `USE_COMMERCIAL` — a
  self-hosted EE deployment without Stripe billing wired up should still be able to turn on
  observability.

Setting `ENABLE_OBSERVABILITY=true` on a Community build is inert: the code that reads
`config.observability` (`ee/observability/init.ts`) does not exist in that build, so there is
nothing to turn on. This mirrors how `USE_COMMERCIAL=true` is inert once `ee/` is deleted.

## Traces

Tracing is `@vercel/otel`'s `registerOTel()`, called from `initializeObservability()` in
`ee/observability/init.ts`, itself called once at process start from the root
`instrumentation.ts`. `registerOTel()` auto-instruments Next.js route handlers and outgoing
`fetch` calls, so every API route gets a trace for free with no code changes.

Two execution paths have no automatic HTTP-level tracing and get a manual span instead:

- `llm.enrich_message` — `lib/llm/enrichment.ts`, wrapping the LLM enrichment call.
- `webhook.process_email_job` — `lib/webhooks/worker.ts`, wrapping BullMQ job processing. A queued
  job is not an HTTP request, so `@vercel/otel`'s auto-instrumentation never sees it; this is the
  one path that needed an explicit span.

Both use `trace.getTracer(...).startActiveSpan(...)` from `@opentelemetry/api` directly, not a
shared helper — there are only two call sites.

There is no sampling in this phase: every trace is exported. Sampling is out of scope (see below).

## Logs

Two independent, additive pieces, both in `lib/logger.config.ts`:

1. **Trace-log correlation.** A Pino `mixin` reads the active OpenTelemetry span via
   `@opentelemetry/api` (the API package only, never the SDK) and, when one exists, attaches
   `trace_id`/`span_id` to the log line. This is unconditional and community-safe: with no SDK
   registered — Community Edition, or an EE build with `ENABLE_OBSERVABILITY=false` —
   `trace.getSpan(context.active())` returns `undefined` and the mixin is a no-op.
2. **Log shipping.** `registerExtraLogTransport()`, called only from
   `ee/observability/init.ts`, adds a `pino-opentelemetry-transport` target alongside the
   existing stdout output. In production this now runs through a multi-target Pino config —
   `pino/file` with destination `1` reproduces the plain JSON-to-stdout behavior prod already had,
   so `docker logs` sees the exact same output whether or not shipping is enabled.

## Ordering constraint

`registerExtraLogTransport()` must run before the first `getLogger()`/`logger.*` call anywhere in
the process — Pino has no API to add a transport to an already-constructed logger. Calling it
after that point throws, deliberately: a transport that silently fails to attach would look
configured while shipping nothing.

The call order in `instrumentation.ts`, inside the `NEXT_RUNTIME === 'nodejs'` branch, is:

1. `assertConfig()` — validates all config domains, including `observability`, and fails boot on a
   malformed value.
2. `initializeObservability()` — registers tracing and, if enabled, the extra log transport.
3. `initializeCommercialPlans()` — the first thing in the boot sequence that would otherwise
   construct the shared logger singleton.
4. Worker registration (`lib/instrumentation.ts`'s `register()`).

`initializeObservability()` running before `initializeCommercialPlans()` is the load-bearing part
of this ordering — it is the last safe point to register a transport before something else in the
boot sequence logs.

## Why generic OTel env vars, not Grafana-specific config

`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_SERVICE_NAME` are standard
OpenTelemetry SDK environment variables. `@vercel/otel` and `pino-opentelemetry-transport` both
read them directly from `process.env` — they are never re-plumbed through `config.observability`.
`config.observability` exists purely so `assertConfig()` can validate them at boot (present,
non-empty, required together); `ee/observability/init.ts` never reads the endpoint or headers
values back out of `config`. This means any OTLP-compatible backend works, not just Grafana —
Grafana Cloud is what the operator guide documents as a free reference backend, not something the
code is coupled to.

## Build note

`pino-opentelemetry-transport` is externalized in `next.config.mjs`'s `serverExternalPackages`,
alongside `pino`, `pino-pretty`, and `thread-stream`, for the same reason those are: it is loaded
by Pino's worker-thread transport loader from a string target name, not a static import, so
Turbopack and webpack must not try to bundle it.

For the standalone production build, `outputFileTracingIncludes` turned out to be necessary — this
was verified empirically with a controlled A/B build, not assumed. Removing the
`outputFileTracingIncludes` entry and running `npm run build` left
`pino-opentelemetry-transport` genuinely absent from `.next/standalone/**/node_modules/`;
restoring the entry made it present again. Next's output-file tracing for `standalone` follows
static imports and does not see a runtime `require()` string, so without the explicit include the
package would be missing from the production image and log shipping would fail at runtime with a
module-not-found error. `next.config.mjs` now carries:

```js
outputFileTracingIncludes: {
  'instrumentation': ['./node_modules/pino-opentelemetry-transport/**/*'],
},
```

keyed on `'instrumentation'` because that is the root-level file whose trace covers the whole
server bundle.

## Out of scope

- Metrics (only logs and traces ship).
- Self-hosted Grafana/Loki/Tempo, or any bundled backend, as an alternative to a customer-operated
  OTLP endpoint.
- Trace sampling — every trace is exported in this phase.
- Prisma-level spans (query-level tracing is not instrumented).

## Related

- [`docs/observability-operator-guide.md`](../observability-operator-guide.md) — self-hosted setup
- [`docs/logging.md`](../logging.md) — the base Pino logging guide, including the "Shipping logs
  externally (EE)" section
- [`commercial-layer.md`](commercial-layer.md) — the build/runtime gate pattern this mirrors
