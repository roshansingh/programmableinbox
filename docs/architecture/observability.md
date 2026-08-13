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

Two manual spans exist, for two different reasons:

- `webhook.process_email_job` — `lib/webhooks/worker.ts`, wrapping BullMQ job processing. This is
  the one execution path with genuinely no automatic tracing: a queued job is not an HTTP request,
  so `@vercel/otel`'s auto-instrumentation never sees it.
- `llm.enrich_message` — `lib/llm/enrichment.ts`, wrapping the LLM enrichment call. This one is
  called from two places, and only one of them lacks automatic tracing: the async worker path
  (`processEmailWebhookJob`, above, which has no automatic tracing of its own) and the synchronous
  webhook route (`app/api/webhooks/email/route.ts`), which *is* an HTTP route already auto-traced
  by `@vercel/otel`. On the synchronous path this span is a nested child span for visibility into
  that specific step, not a substitute for tracing the request.

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

The registered-targets list and the "already built" flag both live on `globalThis` (via a
`globalForLoggerConfig`-style cast, the same pattern `lib/db.ts` uses for its Prisma singleton),
not module scope. This is process-global specifically because a module-scoped array would not
survive webpack's per-chunk duplication in a production build: webpack can compile the same
source module into multiple separate bundled copies across different entry points/chunks, so if
`instrumentation.ts` and an API route resolved to two different compiled copies of
`lib/logger.config.ts`, a module-scoped `registerExtraLogTransport()` would push into an array
nobody else ever reads — the whole log-shipping feature would silently become a no-op with no
error anywhere. `globalThis` is the one true JS global shared by the entire process no matter how
webpack chunks the code.

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
OpenTelemetry SDK environment variables, but they don't all reach the exporters the same way:

- `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are read directly from
  `process.env` by `@vercel/otel` and `pino-opentelemetry-transport` themselves —
  `ee/observability/init.ts` never reads `config.observability.otlpEndpoint` or `.otlpHeaders`
  back out of `config` and passes neither to `registerOTel()` or the log transport. For these two,
  `config.observability` exists purely so `assertConfig()` can validate them at boot (present,
  non-empty, required together); at runtime they flow straight from the environment to the
  libraries, bypassing `config` entirely.
- `OTEL_SERVICE_NAME` is different: `config.observability.serviceName` (defaulted to `'inboxui'`
  if unset) *is* read back out of `config` and passed explicitly —
  `registerOTel(config.observability.serviceName)` and
  `resourceAttributes: { 'service.name': config.observability.serviceName }` on the log transport.
  It is the one field in `config.observability` with a genuine runtime role beyond boot-time
  validation.

Either way, none of this is Grafana-specific: any OTLP-compatible backend works, since the
libraries speak the standard OTel protocol regardless of where the endpoint points. Grafana Cloud
is what the operator guide documents as a free reference backend, not something the code is
coupled to.

## Build note

`pino-opentelemetry-transport` is externalized in `next.config.mjs`'s `serverExternalPackages`,
alongside `pino`, `pino-pretty`, and `thread-stream`, for the same reason those are: it is loaded
by Pino's worker-thread transport loader from a string target name, not a static import, so
Turbopack and webpack must not try to bundle it.

**What actually makes the package available in the deployed image is `Dockerfile`'s full
`node_modules` copy** (the `COPY --from=builder --chown=nextjs:nodejs /app/node_modules
./node_modules` line, currently line 41), which overlays the entire builder-stage `node_modules`
on top of the trimmed `.next/standalone` copy. Since that overlay includes every package
unconditionally, `pino-opentelemetry-transport` — and everything it requires at runtime — is
present in the running container regardless of what Next's output-file tracing decided to
include.

`outputFileTracingIncludes` is a secondary, currently-incomplete safety net, not the primary
mechanism. It was added because Next's output-file tracing for `standalone` follows static
imports and does not see a runtime `require()` string — verified empirically with a controlled
A/B build of `.next/standalone` in isolation (a different artifact from the Docker image that
actually ships): removing the entry and running `npm run build` left
`pino-opentelemetry-transport` genuinely absent from `.next/standalone/**/node_modules/`;
restoring it made it present again. That test demonstrates the tracing gap in `.next/standalone`
on its own — it does not prove anything about runtime correctness of the deployed Docker image,
since the image never ships `.next/standalone`'s trimmed `node_modules` unmodified in the first
place. `next.config.mjs` carries:

```js
outputFileTracingIncludes: {
  'instrumentation': ['./node_modules/pino-opentelemetry-transport/**/*'],
},
```

keyed on `'instrumentation'` because that is the root-level file whose trace covers the whole
server bundle. Even as defense-in-depth, this entry is incomplete on its own: the glob only
covers `pino-opentelemetry-transport` itself, not its hoisted sibling dependencies that it
`require()`s at runtime — `@opentelemetry/exporter-logs-otlp-proto` (the default exporter when no
explicit protocol env var is set), `exporter-logs-otlp-http`, `exporter-logs-otlp-grpc`,
`otlp-exporter-base`, `otlp-grpc-exporter-base`, and `otlp-transformer`. So a future deployment
path that trims `Dockerfile`'s full `node_modules` copy down to the traced/standalone set would
need this include expanded before `outputFileTracingIncludes` alone could carry the feature.

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
