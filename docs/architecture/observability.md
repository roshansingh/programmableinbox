# Observability: log search & tracing

This doc describes the design of EE/SaaS-only log search and distributed tracing — the seam
between the two, not a how-to. For self-hosted setup, see
[`docs/observability-operator-guide.md`](../observability-operator-guide.md).

## Overview

This ships two things: OpenTelemetry distributed tracing across request handlers and background
jobs, and log shipping to an external backend with trace/log correlation. Both are EE/SaaS-only.

Traces and logs reach the backend by two different paths that meet at one local
`otel-collector` container (`deploy/otel-collector.yaml`), not by the app pushing both directly:

- **Traces**: the app pushes OTLP straight to the collector (`@vercel/otel`, same as before —
  only the destination changed, from the public backend to the local collector).
- **Logs**: the collector's `filelog` receiver tails this host's Docker stdout files (the
  `json-file` log driver's `*-json.log` output) and parses Pino's JSON lines. The app does not
  push logs anywhere itself.

The collector then re-exports both signals over OTLP to whatever backend an operator configures
(`OTEL_EXPORTER_ENDPOINT`/`OTEL_EXPORTER_AUTH` on the collector, distinct from the app's own
`OTEL_EXPORTER_OTLP_*` vars). There is still no bundled Grafana, Loki, or Tempo — the collector is
a routing/parsing hop, not a backend.

This is a deliberate change from an earlier version of this design, which had the app push logs
directly over OTLP too (`pino-opentelemetry-transport`, removed). That worked, but tied log
delivery to the app process getting a chance to flush an in-process batch exporter; tailing the
container's own stdout — which `docker logs` already relies on for the exact same data — does not.

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

Two independent pieces, split between the app and the collector:

1. **Trace-log correlation** (`lib/logger.config.ts`). A Pino `mixin` reads the active
   OpenTelemetry span via `@opentelemetry/api` (the API package only, never the SDK) and, when one
   exists, attaches `trace_id`/`span_id` to the log line. This is unconditional and
   community-safe: with no SDK registered — Community Edition, or an EE build with
   `ENABLE_OBSERVABILITY=false` — `trace.getSpan(context.active())` returns `undefined` and the
   mixin is a no-op. This is still how logs and traces end up correlated even though they no
   longer share an in-process exporter — see "Trace/log correlation without a shared exporter"
   below.
2. **Log shipping** (`deploy/otel-collector.yaml`, outside the app process entirely). The
   collector's `filelog` receiver tails `/var/lib/docker/containers/*/*-json.log` — every
   container's stdout, via Docker's `json-file` log driver — and parses each line as JSON.
   Pino writing plain JSON to stdout in production (no `pino-pretty`) is what makes this parseable
   at all; see "Why this depends on JSON stdout" below. Non-app containers (postgres, caddy,
   redis, ...) don't write JSON, so those lines pass through with their raw text as the log body
   instead of being dropped — the collector doesn't try to filter by container.

`registerExtraLogTransport()` (`lib/logger.config.ts`) still exists as generic multi-target Pino
infrastructure — it is what an in-process log-shipping transport would use, and is still exercised
by `lib/__tests__/logger.test.ts` — but nothing in this codebase calls it today. Log shipping now
happens entirely outside the app process.

## Why this depends on JSON stdout

`buildLoggerConfig()` (`lib/logger.config.ts`) only uses `pino-pretty` when
`!config.runtime.isProduction`, i.e. `NODE_ENV !== 'production'`. `Dockerfile`'s runtime stage sets
`NODE_ENV=production` unconditionally, so the deployed container already writes plain JSON lines
to stdout regardless of this feature — that was true before this collector existed, for the
ordinary "read `docker logs`" case. What changed is that this JSON now has a second consumer: the
collector's `json_parser` operator needs every line to be a single JSON object to extract `level`,
`msg`, `time`, `trace_id`, `span_id`, and any other fields onto the exported log record. A pretty,
colorized line (ANSI escape codes and all) would fail to parse — the `on_error: send` setting on
that operator means it wouldn't crash the pipeline, but the record would carry the whole raw pretty
line as an unstructured body, with no severity, no timestamp fix-up, and no trace correlation.

## Trace/log correlation without a shared exporter

Grafana's "jump from a span to its logs" feature needs a log record's actual OTel trace context —
not just a `trace_id` string sitting in a JSON field — to match it against a trace. When both
signals shared the app's own OTel SDK (the removed `pino-opentelemetry-transport` path), the SDK
did this bookkeeping automatically. With logs now sourced from parsed stdout instead, nothing
upstream of the collector knows about OTel's data model, so the collector's `transform/logs`
processor does it explicitly: `TraceID`/`SpanID` OTTL statements read the `trace_id`/`span_id`
attributes the Pino mixin already put on each JSON line and set them as the log record's real
trace context, then delete the now-redundant attributes. Both statements — and the `service.name`
stamping described below — are guarded on `attributes["level"] != nil`, present only for lines the
receiver's `json_parser`/`severity_parser` operators actually parsed as Pino JSON, so this is a
no-op for every other container's output rather than something that needs a separate per-container
filter.

## Ordering

`instrumentation.ts`, inside the `NEXT_RUNTIME === 'nodejs'` branch, still calls
`initializeObservability()` before `initializeCommercialPlans()`, but for a different reason than
before: `registerOTel()`'s auto-instrumentation patches Node's module loader, which is only
effective for modules not yet `require()`'d — so it needs to run as early in the boot sequence as
possible, not specifically "before the Pino singleton exists" (that constraint applied to the
now-removed log transport registration, not to tracing).

## Why generic OTel env vars, not Grafana-specific config

`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_SERVICE_NAME` are standard
OpenTelemetry SDK environment variables, but they don't all reach the exporter the same way:

- `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are read directly from
  `process.env` by `@vercel/otel` itself — `ee/observability/init.ts` never reads
  `config.observability.otlpEndpoint`/`.otlpHeaders` back out of `config` and passes neither to
  `registerOTel()`. For these two, `config.observability` exists purely so `assertConfig()` can
  validate them at boot (present, non-empty, required together); at runtime they flow straight
  from the environment to `@vercel/otel`, bypassing `config` entirely. As of the collector
  architecture above, `OTEL_EXPORTER_OTLP_ENDPOINT` now points at the local `otel-collector`
  service rather than a public OTLP gateway, and `OTEL_EXPORTER_OTLP_HEADERS` carries no real
  secret — it's still required because `assertConfig()` has no way to know the endpoint is a
  same-host collector rather than a public backend; any non-empty value satisfies it.
- `OTEL_SERVICE_NAME` is different: `config.observability.serviceName` (defaulted to `'inboxui'`
  if unset) *is* read back out of `config` and passed explicitly to
  `registerOTel(config.observability.serviceName)`. It is the one field in `config.observability`
  with a genuine runtime role beyond boot-time validation. `deploy/otel-collector.yaml`'s
  `transform/logs` processor separately reads the same value from its own `OTEL_SERVICE_NAME`
  (set in `otel-collector.env`, a file distinct from the app's `app.env` — see the compose file's
  `env_file` comment on the `otel-collector` service for why) so log records carry a matching
  `service.name` even though they never pass through the app's OTel SDK.

None of this is Grafana-specific: the collector's own outbound exporter
(`deploy/otel-collector.yaml`) speaks standard OTLP/HTTP, so any OTLP-compatible backend works.
Grafana Cloud is what the operator guide documents as a free reference backend, not something the
code is coupled to.

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
