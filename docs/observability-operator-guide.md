# Observability (log search & tracing) — Operator Guide

## Overview

This guide walks a self-hosted operator through enabling EE/SaaS-only log search and distributed
tracing: standing up the local `otel-collector` container, setting the env vars that point the app
and the collector at each other and at your OpenTelemetry backend, and confirming traces and
correlated logs actually show up. There **is** one new container (`otel-collector`) — it's opt-in
via a Docker Compose profile, and there's still no schema migration.

> **Note for Community Edition readers**: this guide only applies to the EE/SaaS build.
> `docs/` is not stripped by `scripts/foss.mjs` — only code under `ee/` is — so this file remains
> visible in a Community checkout even though following it does nothing there: the code that
> reads `ENABLE_OBSERVABILITY` lives in `ee/observability/`, which does not exist in a stripped
> build. See [`docs/architecture/commercial-layer.md`](architecture/commercial-layer.md) for the
> open-core split.

For the design behind this feature — why traces and logs travel by different paths to the same
collector, how log/trace correlation survives that split, and what is explicitly out of scope —
see [`docs/architecture/observability.md`](architecture/observability.md).

## Prerequisites

- A free [Grafana Cloud](https://grafana.com/products/cloud/) account, or any other
  OTLP-compatible backend (Grafana Cloud is used as the reference below; the collector only
  speaks standard OpenTelemetry and is not coupled to Grafana).

## Environment Setup

1. Create a Grafana Cloud stack (or use an existing one).
2. In the stack, go to **Connections → Add new connection → OpenTelemetry (OTLP)** and copy the
   OTLP gateway URL shown there — this is `OTEL_EXPORTER_ENDPOINT` (the **collector's** var, not
   the app's — see the table below).
3. Generate an API token from the same page (or **Administration → API Keys**) with
   metrics/logs/traces write scope.
4. Build the Basic auth header value:

   ```bash
   echo -n "<instanceID>:<token>" | base64
   ```

   Then set:

   ```bash
   OTEL_EXPORTER_AUTH=Basic <that base64 string>
   ```

5. Add all of the following to `/srv/inboxui/secrets/app.env` (see
   [`deploy/README.md`](../deploy/README.md), Part 3). Both containers read the same file via
   `env_file`, but each only uses its own half:

   | Variable | Read by | Value |
   |---|---|---|
   | `ENABLE_OBSERVABILITY` | app | `true` |
   | `OTEL_EXPORTER_OTLP_ENDPOINT` | app | `http://otel-collector:4318` — the collector, on the internal docker network, **not** Grafana |
   | `OTEL_EXPORTER_OTLP_PROTOCOL` | app | `http/protobuf` |
   | `OTEL_EXPORTER_OTLP_HEADERS` | app | any non-empty value, e.g. `X-Local-Collector=unused` — required by `assertConfig()`, but carries no real secret since the app never talks to Grafana directly |
   | `OTEL_SERVICE_NAME` | app + collector | `inboxui` (default) or your choice — keep it the same value for both, since the collector's log pipeline stamps it onto log records so they match the app's trace resource |
   | `OTEL_EXPORTER_ENDPOINT` | collector | the Grafana OTLP gateway URL from step 2 |
   | `OTEL_EXPORTER_AUTH` | collector | the `Basic ...` header value from step 4 |

6. Bring up the app **and** the collector — the collector is gated behind the `observability`
   compose profile, so a plain `docker compose up -d`/`restart app` will not start it:

   ```bash
   docker compose --profile observability up -d
   ```

   No migration to run. If observability was already on and you're only rotating credentials,
   `docker compose --profile observability restart app otel-collector` is enough.

## Verification

1. Make a request through the app (log in, load an inbox, send a message — anything that hits an
   API route).
2. Check the collector isn't erroring: `docker compose logs otel-collector` — startup errors here
   (bad OTTL statements, an unreachable `OTEL_EXPORTER_ENDPOINT`, permission denied reading
   `/var/lib/docker/containers`) show up loudly, unlike an app-side exporter failure.
3. In Grafana, open **Explore**, select the Tempo/Traces data source, and confirm a trace for that
   request appears.
4. Select the Loki/Logs data source and confirm the corresponding log lines appear, carrying
   `trace_id`/`span_id` fields that match the trace from step 3.
5. From the trace view, click a span and confirm Grafana can jump to its correlated logs (this is
   what the collector's `transform/logs` processor sets up — see
   [`docs/architecture/observability.md`](architecture/observability.md#trace-log-correlation-without-a-shared-exporter)).

## Troubleshooting

**App won't start after setting `ENABLE_OBSERVABILITY=true`.**
`assertConfig()` is refusing to boot because `OTEL_EXPORTER_OTLP_ENDPOINT` or
`OTEL_EXPORTER_OTLP_HEADERS` is missing or malformed on the **app's** side — the startup error
names the offending variable. Fix: fill in the missing/malformed value (any non-empty string
satisfies `OTEL_EXPORTER_OTLP_HEADERS`), or set `ENABLE_OBSERVABILITY` back to `false`.

**Traces appear in Grafana but logs don't (or vice versa).**
The two signals take genuinely different paths now, so a failure in one doesn't imply a failure in
the other:

- No traces: check `OTEL_EXPORTER_OTLP_ENDPOINT`/`_PROTOCOL` on the **app** side, and confirm the
  collector container is actually running (`docker compose ps otel-collector` — remember it needs
  the `observability` profile to start at all).
- No logs: check `docker compose logs otel-collector` for `filelog` receiver errors — the most
  common one is permission denied reading `/var/lib/docker/containers`, since that directory is
  usually root-only and the collector image runs as a non-root user by default. If you see that,
  add `user: "0:0"` to the `otel-collector` service in `docker-compose.yml`. Also confirm the app
  is actually writing JSON to stdout in this environment: `docker compose logs app | head -1`
  should be a single-line JSON object, not colorized/multi-line text — if it isn't, `NODE_ENV`
  probably isn't `production` in whatever is running the image (the shipped `Dockerfile` always
  sets it, so this would mean a non-standard build).

**Nothing appears in Grafana at all, from either signal.**
The collector's own credentials are wrong — a typo in `OTEL_EXPORTER_ENDPOINT`, an expired
`OTEL_EXPORTER_AUTH` token, or the wrong region's gateway URL. Unlike the old direct-push design,
this now fails loudly: check `docker compose logs otel-collector` for export errors (HTTP 401/403
from the backend, DNS failures, etc.) rather than assuming it's silent by design.
