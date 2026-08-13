# Observability (log search & tracing) — Operator Guide

## Overview

This guide walks a self-hosted operator through enabling EE/SaaS-only log search and distributed
tracing: setting the four env vars that point the app at an OpenTelemetry backend, and confirming
traces and correlated logs actually show up. There is no new container and no schema migration —
it is a config-only change plus a restart of the `app` service.

> **Note for Community Edition readers**: this guide only applies to the EE/SaaS build.
> `docs/` is not stripped by `scripts/foss.mjs` — only code under `ee/` is — so this file remains
> visible in a Community checkout even though following it does nothing there: the code that
> reads `ENABLE_OBSERVABILITY` lives in `ee/observability/`, which does not exist in a stripped
> build. See [`docs/architecture/commercial-layer.md`](architecture/commercial-layer.md) for the
> open-core split.

For the design behind this feature — why it exports directly over OTLP rather than bundling a
backend, how tracing and log shipping are wired, and what is explicitly out of scope — see
[`docs/architecture/observability.md`](architecture/observability.md).

## Prerequisites

- A free [Grafana Cloud](https://grafana.com/products/cloud/) account, or any other
  OTLP-compatible backend (Grafana Cloud is used as the reference below; the app only speaks
  standard OpenTelemetry and is not coupled to Grafana).

## Environment Setup

1. Create a Grafana Cloud stack (or use an existing one).
2. In the stack, go to **Connections → Add new connection → OpenTelemetry (OTLP)** and copy the
   OTLP gateway URL shown there — this is `OTEL_EXPORTER_OTLP_ENDPOINT`.
3. Generate an API token from the same page (or **Administration → API Keys**) with
   metrics/logs/traces write scope.
4. Build the Basic auth header value:

   ```bash
   echo -n "<instanceID>:<token>" | base64
   ```

   Then set:

   ```bash
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <that base64 string>
   ```

5. Set `ENABLE_OBSERVABILITY=true` and, optionally, `OTEL_SERVICE_NAME` (defaults to `inboxui`).
6. Add all four (`ENABLE_OBSERVABILITY`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
   `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`) to `/srv/inboxui/secrets/app.env` (see
   [`deploy/README.md`](../deploy/README.md), Part 3) and restart the `app` service:

   ```bash
   docker compose restart app
   ```

   No other services need restarting, and there is no migration to run.

## Verification

1. Make a request through the app (log in, load an inbox, send a message — anything that hits an
   API route).
2. In Grafana, open **Explore**, select the Tempo/Traces data source, and confirm a trace for that
   request appears.
3. Select the Loki/Logs data source and confirm the corresponding log lines appear, carrying
   `trace_id`/`span_id` fields that match the trace from step 2.
4. From the trace view, click a span and confirm Grafana can jump to its correlated logs (this is
   what the `trace_id`/`span_id` correlation is for).

## Troubleshooting

**App won't start after setting `ENABLE_OBSERVABILITY=true`.**
`assertConfig()` is refusing to boot because `OTEL_EXPORTER_OTLP_ENDPOINT` or
`OTEL_EXPORTER_OTLP_HEADERS` is missing or malformed — the startup error names the offending
variable. Fix: fill in the missing/malformed value, or set `ENABLE_OBSERVABILITY` back to `false`.

**App boots fine, but nothing appears in Grafana.**
The endpoint or headers are wrong — a typo, an expired token, or the wrong region's gateway URL.
This fails silently by design: a broken exporter must never take down request handling. Fix:
double-check the values against the Grafana Cloud connection page and confirm the token hasn't
expired.
