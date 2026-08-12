# EE Observability: Log Search & OpenTelemetry Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship structured log search and distributed tracing, gated to the EE/SaaS build only, exported directly from the running container over OTLP with no additional Docker services.

**Architecture:** A build-time gate (`ee/observability/`, stripped from Community builds by the existing `scripts/foss.mjs`) plus a runtime flag (`ENABLE_OBSERVABILITY`, default `false`) control a thin wiring layer that calls `@vercel/otel`'s `registerOTel()` for traces and registers an additional Pino transport target for logs. Trace-log correlation (`trace_id`/`span_id` on every log line) and the manual spans around webhook ingest / LLM enrichment live in shared code using only `@opentelemetry/api` — inert with no SDK registered, so safe in the Community build.

**Tech Stack:** Next.js 16 instrumentation hook, `@vercel/otel`, `@opentelemetry/api`, `pino-opentelemetry-transport`, Zod (`lib/config`), Vitest.

## Global Constraints

- Feature is off by default even on an EE build: `ENABLE_OBSERVABILITY=false` unless set.
- No new Docker services or Compose profiles — `deploy/docker-compose.yml` is unchanged; only `deploy/README.md`'s documented `app.env` contents grow.
- No Grafana-specific code — only standard OpenTelemetry SDK environment variable names (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`). Grafana Cloud is documentation, not code.
- No trace sampling in this phase — always-on when enabled.
- `npm run test` must pass with no decrease in test count before any PR (per `CLAUDE.md`).
- Follow `lib/config/schema.ts`'s existing domain-schema conventions exactly: `superRefine` for conditional requirements, `zSecret`/`zUrl`/`zBool` primitives, one `DOMAIN_SCHEMAS` entry whose `vars` list is authoritative.
- `ee/` code is reached only via `await import(...)` from the non-FOSS `instrumentation.ts` — never a static import from shared code, and `instrumentation.foss.ts` never references it.

---

### Task 1: Add OpenTelemetry dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@opentelemetry/api`, `@vercel/otel`, `@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`, `@opentelemetry/instrumentation`, `pino-opentelemetry-transport` available to later tasks.

- [ ] **Step 1: Install the packages**

Run:

```bash
npm install @opentelemetry/api@^1.9.1 @vercel/otel@^2.1.3 @opentelemetry/api-logs@^0.221.0 @opentelemetry/sdk-logs@^0.221.0 @opentelemetry/instrumentation@^0.221.0 pino-opentelemetry-transport@^4.0.2
```

`pino-opentelemetry-transport`'s peer dependency is `pino: ^10.0.0`, which this repo already satisfies (`pino@^10.3.1`).

- [ ] **Step 2: Verify install**

Run: `npm ls @opentelemetry/api @vercel/otel pino-opentelemetry-transport`
Expected: all three resolve with no `UNMET PEER DEPENDENCY` warnings.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add OpenTelemetry packages for EE observability"
```

---

### Task 2: Config — `ObservabilitySchema` domain

**Files:**
- Modify: `lib/config/schema.ts`
- Create: `lib/config/__tests__/schema-observability.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `zBool`, `zUrl`, `zSecret`, `zNonEmpty` from `lib/config/primitives.ts` / `lib/config/secret.ts` (already imported at the top of `schema.ts`).
- Produces: `config.observability: { enabled: boolean; otlpEndpoint: string | null; otlpHeaders: Secret | null; serviceName: string }`, consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `lib/config/__tests__/schema-observability.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { parseDomain, resetConfigCache, ConfigError } from '@/lib/config'

/**
 * The `observability` domain: EE-only log shipping and tracing (see
 * docs/architecture/observability.md). `ENABLE_OBSERVABILITY` is inert on a
 * Community build regardless of this schema's validation — the wiring that
 * reads `config.observability` lives entirely in `ee/observability/`, which
 * `scripts/foss.mjs` deletes. This schema exists so a misconfigured EE
 * deployment fails at boot naming the variable, same as every other
 * conditionally-required flag in this file.
 */
const VARS = [
  'ENABLE_OBSERVABILITY',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SERVICE_NAME',
] as const

const ORIGINAL = Object.fromEntries(VARS.map((name) => [name, process.env[name]]))

function withEnv(values: Partial<Record<(typeof VARS)[number], string | undefined>>) {
  for (const name of VARS) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
  return parseDomain('observability')
}

afterEach(() => {
  for (const name of VARS) {
    const value = ORIGINAL[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetConfigCache()
})

describe('observability config domain', () => {
  it('is off by default, with no endpoint/headers required', () => {
    const config = withEnv({})
    expect(config.enabled).toBe(false)
    expect(config.otlpEndpoint).toBeNull()
    expect(config.otlpHeaders).toBeNull()
    expect(config.serviceName).toBe('inboxui')
  })

  it('parses a complete configuration', () => {
    const config = withEnv({
      ENABLE_OBSERVABILITY: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
    })
    expect(config.enabled).toBe(true)
    expect(config.otlpEndpoint).toBe('https://otlp-gateway-prod-us-east-0.grafana.net/otlp')
    expect(config.otlpHeaders?.reveal()).toBe('Authorization=Basic dGVzdDp0ZXN0')
  })

  it('boxes OTEL_EXPORTER_OTLP_HEADERS so it cannot be logged by accident', () => {
    const config = withEnv({
      ENABLE_OBSERVABILITY: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
    })
    expect(String(config.otlpHeaders)).toBe('[redacted]')
    expect(JSON.stringify(config.otlpHeaders)).toBe('"[redacted]"')
  })

  it('defaults serviceName to inboxui when unset', () => {
    expect(withEnv({}).serviceName).toBe('inboxui')
  })

  it('reads OTEL_SERVICE_NAME when set', () => {
    expect(withEnv({ OTEL_SERVICE_NAME: 'my-inboxui' }).serviceName).toBe('my-inboxui')
  })

  it('throws on a malformed flag rather than reading it as off', () => {
    expect(() => withEnv({ ENABLE_OBSERVABILITY: 'yes-please' })).toThrow(ConfigError)
  })

  describe('requirements when enabled', () => {
    it('requires OTEL_EXPORTER_OTLP_ENDPOINT', () => {
      expect(() =>
        withEnv({
          ENABLE_OBSERVABILITY: 'true',
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
        }),
      ).toThrow(ConfigError)
    })

    it('requires OTEL_EXPORTER_OTLP_HEADERS', () => {
      expect(() =>
        withEnv({
          ENABLE_OBSERVABILITY: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
        }),
      ).toThrow(ConfigError)
    })

    it('names both variables when both are missing', () => {
      try {
        withEnv({ ENABLE_OBSERVABILITY: 'true' })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        const { variables } = error as ConfigError
        expect(variables).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
        expect(variables).toContain('OTEL_EXPORTER_OTLP_HEADERS')
      }
    })

    it('rejects a non-URL endpoint', () => {
      expect(() =>
        withEnv({
          ENABLE_OBSERVABILITY: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url',
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
        }),
      ).toThrow(ConfigError)
    })

    it('does not demand endpoint/headers while the flag is off', () => {
      const config = withEnv({ ENABLE_OBSERVABILITY: 'false' })
      expect(config.otlpEndpoint).toBeNull()
      expect(config.otlpHeaders).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node lib/config/__tests__/schema-observability.test.ts`
Expected: FAIL — `parseDomain('observability')` throws because the `observability` domain does not exist in `DOMAIN_SCHEMAS` yet.

- [ ] **Step 3: Add `ObservabilitySchema` to `lib/config/schema.ts`**

Insert after `RateLimitSchema` (before the `// Registry` comment block):

```ts
/**
 * EE-only observability: OpenTelemetry log export and tracing, shipped over
 * OTLP directly from the running container. See docs/architecture/observability.md.
 *
 * Off by default even on an EE build — not tied to `USE_COMMERCIAL`, since a
 * self-hosted EE deployment without Stripe billing should still be able to
 * turn this on. Setting `ENABLE_OBSERVABILITY=true` on a Community build is
 * inert: the code that reads `config.observability` lives entirely in
 * `ee/observability/`, which `scripts/foss.mjs` deletes — same shape as
 * `USE_COMMERCIAL` on a Community build.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are the
 * standard OpenTelemetry SDK environment variable names, not
 * Grafana-specific ones — any OTLP-compatible backend works. This schema
 * exists purely so a set-but-incomplete configuration fails loudly at boot;
 * `ee/observability/init.ts` never reads these two values back out of
 * `config` — the OTel exporters read the same-named env vars directly.
 */
const ObservabilitySchema = z
  .object({
    ENABLE_OBSERVABILITY: zBool.optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: zUrl(['http:', 'https:']).optional(),
    OTEL_EXPORTER_OTLP_HEADERS: zSecret().optional(),
    OTEL_SERVICE_NAME: zNonEmpty.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.ENABLE_OBSERVABILITY) return

    for (const name of ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_HEADERS'] as const) {
      if (!v[name]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: 'is required when ENABLE_OBSERVABILITY is true',
        })
      }
    }
  })
  .transform((v) => ({
    enabled: v.ENABLE_OBSERVABILITY ?? false,
    otlpEndpoint: v.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
    otlpHeaders: v.OTEL_EXPORTER_OTLP_HEADERS ?? null,
    serviceName: v.OTEL_SERVICE_NAME ?? 'inboxui',
  }))
```

Then add the registry entry inside `DOMAIN_SCHEMAS`, after the `rateLimit` entry:

```ts
  observability: {
    schema: ObservabilitySchema,
    vars: [
      'ENABLE_OBSERVABILITY',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'OTEL_SERVICE_NAME',
    ],
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project node lib/config/__tests__/schema-observability.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run the `.env.example` coverage test**

Run: `npx vitest run --project node lib/config/__tests__/env-example.test.ts`
Expected: FAIL — `.env.example` does not document the four new variables yet.

- [ ] **Step 6: Document the variables in `.env.example`**

Append after the `MCP server (issue #104)` section:

```
# ---------------------------------------------------------------------------
# Observability: log search & tracing (EE)
# ---------------------------------------------------------------------------

# Ships structured logs and traces over the OpenTelemetry protocol (OTLP)
# directly from the running container — no bundled Grafana/Loki, no sidecar
# container. EE/SaaS only: this flag is inert on a Community Edition build,
# since the code that reads it (ee/observability/) does not exist there.
# Default false. See docs/observability-operator-guide.md.
# ENABLE_OBSERVABILITY=false

# Standard OpenTelemetry SDK environment variables, read directly by the OTel
# exporters — not funneled through this app's config, so any OTLP-compatible
# backend works, not just Grafana. REQUIRED whenever ENABLE_OBSERVABILITY=true
# and asserted at boot.
# OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 of instanceID:apiToken>

# Service name reported to the OTel backend. Defaults to "inboxui".
# OTEL_SERVICE_NAME=inboxui
```

- [ ] **Step 7: Run the full config test suite**

Run: `npx vitest run --project node lib/config`
Expected: PASS, all files including `env-example.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add lib/config/schema.ts lib/config/__tests__/schema-observability.test.ts .env.example
git commit -m "feat: add observability config domain (ENABLE_OBSERVABILITY)"
```

---

### Task 3: Logger — trace correlation mixin + extra transport registry

**Files:**
- Modify: `lib/logger.config.ts`
- Modify: `lib/__tests__/logger.test.ts`

**Interfaces:**
- Consumes: `config.observability` is NOT read here — this file stays generic. `context`, `trace` from `@opentelemetry/api` (Task 1).
- Produces: `registerExtraLogTransport(target: TransportTargetOptions): void`, exported from `lib/logger.config.ts`, consumed by Task 5. `buildLoggerConfig()`'s returned `LoggerOptions.mixin` now injects `trace_id`/`span_id`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/__tests__/logger.test.ts`, inside the existing `describe('logger config', ...)` block (after the last `it`, before the closing `})`):

```ts
  it('mixin omits trace_id/span_id when no span is active', async () => {
    vi.resetModules()
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()
    const extra = (config.mixin as () => Record<string, unknown>)()

    expect(extra).toEqual({})
  })

  it('mixin includes trace_id/span_id when a span is active', async () => {
    vi.resetModules()
    const { context, trace } = await import('@opentelemetry/api')
    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    const fakeSpan = {
      spanContext: () => ({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      }),
    } as unknown as import('@opentelemetry/api').Span

    const extra = context.with(trace.setSpan(context.active(), fakeSpan), () =>
      (config.mixin as () => Record<string, unknown>)(),
    )

    expect(extra).toEqual({
      trace_id: '0af7651916cd43dd8448eb211c80319c',
      span_id: 'b7ad6b7169203331',
    })
  })

  it('adds a registered extra transport target alongside stdout in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', '')
    vi.resetModules()

    const { buildLoggerConfig, registerExtraLogTransport } = await import('../logger.config')
    registerExtraLogTransport({ target: 'pino-opentelemetry-transport', options: { resourceAttributes: {} } })
    const config = buildLoggerConfig()

    expect(config.transport).toMatchObject({
      targets: [
        { target: 'pino/file', options: { destination: 1 } },
        { target: 'pino-opentelemetry-transport', options: { resourceAttributes: {} } },
      ],
    })
  })

  it('adds a registered extra transport target alongside pino-pretty in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOG_LEVEL', '')
    vi.resetModules()

    const { buildLoggerConfig, registerExtraLogTransport } = await import('../logger.config')
    registerExtraLogTransport({ target: 'pino-opentelemetry-transport', options: {} })
    const config = buildLoggerConfig()

    expect(config.transport).toMatchObject({
      targets: [{ target: 'pino-pretty' }, { target: 'pino-opentelemetry-transport' }],
    })
  })

  it('throws if an extra transport is registered after the logger config was already built', async () => {
    vi.resetModules()
    const { buildLoggerConfig, registerExtraLogTransport } = await import('../logger.config')
    buildLoggerConfig()

    expect(() =>
      registerExtraLogTransport({ target: 'pino-opentelemetry-transport', options: {} }),
    ).toThrow(/already built/)
  })

  it('behaves exactly as before when no extra transport is registered', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('LOG_LEVEL', '')
    vi.resetModules()

    const { buildLoggerConfig } = await import('../logger.config')
    const config = buildLoggerConfig()

    expect(config).not.toHaveProperty('transport')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node lib/__tests__/logger.test.ts`
Expected: FAIL — `registerExtraLogTransport` does not exist, and `config.mixin` is undefined.

- [ ] **Step 3: Implement in `lib/logger.config.ts`**

Replace the full file contents with:

```ts
import type { LoggerOptions, TransportTargetOptions } from 'pino'
import pino from 'pino'
import { context, trace } from '@opentelemetry/api'
import { config } from '@/lib/config'

const extraTransportTargets: TransportTargetOptions[] = []
let built = false

/**
 * Registers an additional Pino transport target, appended alongside the
 * default stdout output the next time `buildLoggerConfig()` runs.
 *
 * Must be called before the first `getLogger()` / `logger.*` call anywhere in
 * the process — Pino has no API to add a transport to an already-constructed
 * logger. The only caller is `ee/observability/init.ts`, and `instrumentation.ts`
 * runs it before anything else in the boot sequence touches the logger, which
 * is what makes the ordering safe. Throws rather than silently doing nothing
 * if that invariant is ever violated: a transport that never gets attached is
 * not a startup crash, it is a deployment that looks configured and ships
 * nothing.
 */
export function registerExtraLogTransport(target: TransportTargetOptions): void {
  if (built) {
    throw new Error(
      'registerExtraLogTransport() called after the logger was already built — ' +
        'it must run before the first getLogger()/logger.* call in the process. ' +
        'See ee/observability/init.ts and its ordering in instrumentation.ts.',
    )
  }
  extraTransportTargets.push(target)
}

const PRETTY_TARGET: TransportTargetOptions = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
  },
}

/**
 * Build the Pino logger configuration based on the current environment.
 *
 * - Development: uses pino-pretty for human-readable, colorized output.
 * - Production: plain JSON output for log aggregators.
 * - Log level defaults to `debug` in development and `info` in production,
 *   but is overridden by the `LOG_LEVEL` environment variable when set.
 *
 * An unrecognised `LOG_LEVEL` is rejected by the config schema rather than
 * warned about and ignored: `LOG_LEVEL=warning` used to mean production quietly
 * kept logging at `info`, with the warning itself buried in the startup output.
 */
export function buildLoggerConfig(): LoggerOptions {
  built = true

  const isDev = !config.runtime.isProduction
  const level = config.logging.level ?? (isDev ? 'debug' : 'info')

  const base: LoggerOptions = {
    level,
    // ISO timestamp on every log line
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      // Serialize Error objects so stack traces appear in structured output.
      // Both keys are registered so { error: e } and { err: e } both produce
      // structured output with message, stack, and type fields.
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    // Injects the active OpenTelemetry span's IDs into every log line, so a
    // trace in Grafana can jump to its matching logs. Uses only the OTel
    // *API* package, never the SDK — with no SDK registered (Community
    // Edition, or EE with ENABLE_OBSERVABILITY off) trace.getSpan returns
    // undefined immediately, so this is a no-op there.
    mixin() {
      const span = trace.getSpan(context.active())
      if (!span) return {}
      const { traceId, spanId } = span.spanContext()
      return { trace_id: traceId, span_id: spanId }
    },
  }

  if (extraTransportTargets.length === 0) {
    if (isDev) {
      return { ...base, transport: PRETTY_TARGET }
    }
    return base
  }

  // Once any extra target is registered, stdout output has to become an
  // explicit target too — Pino's single-target shorthand (dev's pino-pretty,
  // or prod's implicit direct stdout write) and multi-target `targets` are
  // mutually exclusive. `pino/file` with destination 1 reproduces the exact
  // JSON-to-stdout behavior prod has today.
  const stdoutTarget: TransportTargetOptions = isDev
    ? PRETTY_TARGET
    : { target: 'pino/file', options: { destination: 1 } }

  return {
    ...base,
    transport: { targets: [stdoutTarget, ...extraTransportTargets] },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project node lib/__tests__/logger.test.ts`
Expected: PASS, all cases including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add lib/logger.config.ts lib/__tests__/logger.test.ts
git commit -m "feat: add trace correlation mixin and extra log transport registry"
```

---

### Task 4: Externalize `pino-opentelemetry-transport` in the build config

**Files:**
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: nothing new. This task has no code dependency on Task 3's transport target existing — it only needs the package installed (Task 1) — but is sequenced after Task 3 since that's what makes the risk concrete.

- [ ] **Step 1: Update `next.config.mjs`**

`pino-opentelemetry-transport` is a Pino transport package, loaded by Pino's worker-thread loader from a string target name — the same category of package as `pino-pretty` and `thread-stream`, which this repo already had to externalize (see the existing comments in this file) because Turbopack/webpack fail trying to bundle their non-code artifacts. Apply the identical treatment:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Prevent Turbopack (dev) from bundling pino's transport packages.
  // Without this, thread-stream is compiled with virtual /ROOT/... paths that
  // don't exist on disk, so its worker thread spawn fails at runtime.
  // pino-opentelemetry-transport (EE observability log shipping) is the same
  // category of package — loaded by Pino's worker-thread loader from a string
  // target name, never a static import — so it needs the same treatment.
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    'thread-stream',
    'pino-opentelemetry-transport',
  ],
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Mark thread-stream and pino-opentelemetry-transport as external to
      // prevent webpack from bundling their non-code files (LICENSE, test
      // artifacts, etc) that cause build failures. Both are only used at
      // runtime by pino's transport layer, never needed at build time.
      config.externals = [
        ...(config.externals || []),
        'thread-stream',
        'pino-opentelemetry-transport',
      ]
    }
    return config
  },
}

export default nextConfig
```

- [ ] **Step 2: Verify the production build succeeds**

Run: `npm run build`
Expected: build completes with no errors mentioning `pino-opentelemetry-transport`.

- [ ] **Step 3: Verify the standalone output includes the package**

`output: 'standalone'` prunes `node_modules` via file-tracing, which can miss a package that is only ever `require()`'d by a runtime string rather than a static import. Check it actually landed in the traced output:

Run: `ls .next/standalone/node_modules/pino-opentelemetry-transport 2>&1 || echo "MISSING"`

If it prints `MISSING`, add `outputFileTracingIncludes` to `next.config.mjs` (inside the `nextConfig` object, alongside `serverExternalPackages`):

```js
  outputFileTracingIncludes: {
    'instrumentation': ['./node_modules/pino-opentelemetry-transport/**/*'],
  },
```

Then re-run `npm run build` and re-check the `ls` above until the directory is present. Note the actual outcome (present without the extra config, or required it) in this task's commit message or a comment in `next.config.mjs`, since the next engineer needs to know whether this fallback is load-bearing.

- [ ] **Step 4: Commit**

```bash
git add next.config.mjs
git commit -m "build: externalize pino-opentelemetry-transport, matching the thread-stream precedent"
```

---

### Task 5: `ee/observability/init.ts`

**Files:**
- Create: `ee/observability/init.ts`
- Create: `ee/observability/__tests__/init.test.ts`

**Interfaces:**
- Consumes: `config.observability` (Task 2), `registerExtraLogTransport` from `@/lib/logger.config` (Task 3), `registerOTel` from `@vercel/otel` (Task 1), `logger` from `@/lib/logger`.
- Produces: `initializeObservability(): void`, exported from `ee/observability/init.ts`, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `ee/observability/__tests__/init.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const registerOTelMock = vi.fn()
const registerExtraLogTransportMock = vi.fn()
const loggerInfoMock = vi.fn()

vi.mock('@vercel/otel', () => ({ registerOTel: (...a: unknown[]) => registerOTelMock(...a) }))
vi.mock('@/lib/logger.config', () => ({
  registerExtraLogTransport: (...a: unknown[]) => registerExtraLogTransportMock(...a),
}))
vi.mock('@/lib/logger', () => ({
  default: { info: (...a: unknown[]) => loggerInfoMock(...a), warn: vi.fn(), error: vi.fn() },
}))

describe('initializeObservability', () => {
  withConfigEnv({
    ENABLE_OBSERVABILITY: 'true',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway.example.com/otlp',
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('registers OTel tracing and the log transport when enabled', async () => {
    const { initializeObservability } = await import('../init')
    initializeObservability()

    expect(registerOTelMock).toHaveBeenCalledWith('inboxui')
    expect(registerExtraLogTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'pino-opentelemetry-transport',
        options: expect.objectContaining({
          resourceAttributes: { 'service.name': 'inboxui' },
        }),
      }),
    )
    expect(loggerInfoMock).toHaveBeenCalled()
  })

  it('uses OTEL_SERVICE_NAME when set', async () => {
    setConfigEnv({ OTEL_SERVICE_NAME: 'my-inboxui' })
    const { initializeObservability } = await import('../init')
    initializeObservability()

    expect(registerOTelMock).toHaveBeenCalledWith('my-inboxui')
  })

  it('does nothing when the flag is off', async () => {
    setConfigEnv({ ENABLE_OBSERVABILITY: 'false' })
    const { initializeObservability } = await import('../init')
    initializeObservability()

    expect(registerOTelMock).not.toHaveBeenCalled()
    expect(registerExtraLogTransportMock).not.toHaveBeenCalled()
    expect(loggerInfoMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project node ee/observability/__tests__/init.test.ts`
Expected: FAIL — `../init` does not exist.

- [ ] **Step 3: Implement `ee/observability/init.ts`**

```ts
import { registerOTel } from '@vercel/otel'
import { config } from '@/lib/config'
import { registerExtraLogTransport } from '@/lib/logger.config'
import logger from '@/lib/logger'

/**
 * Installs OpenTelemetry tracing and log export (EE observability).
 *
 * Called once at process start from the root `instrumentation.ts`, before
 * `initializeCommercialPlans()` and before anything else in the boot sequence
 * touches the shared logger — `registerExtraLogTransport()` only works before
 * the Pino singleton is constructed (see lib/logger.config.ts), and this is
 * the first place in the boot sequence that could create it.
 *
 * A no-op unless `ENABLE_OBSERVABILITY` is true, which is what makes deleting
 * `ee/` (the Community build) behave identically to leaving the flag off:
 * neither calls `registerOTel()` nor ships a single log line anywhere.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are never
 * read from `config.observability` here — `assertConfig()` already required
 * them to be present and well-formed when the flag is on, but the actual
 * values are picked up directly from `process.env` by `@vercel/otel` and
 * `pino-opentelemetry-transport`, which both follow the standard
 * OpenTelemetry SDK environment-variable convention. Re-plumbing them through
 * our config object into constructor options would just be a second,
 * redundant path to the same values.
 */
export function initializeObservability(): void {
  if (!config.observability.enabled) {
    return
  }

  registerOTel(config.observability.serviceName)

  registerExtraLogTransport({
    target: 'pino-opentelemetry-transport',
    options: {
      resourceAttributes: { 'service.name': config.observability.serviceName },
    },
  })

  logger.info('[observability] OpenTelemetry tracing and log export enabled')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project node ee/observability/__tests__/init.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add ee/observability/init.ts ee/observability/__tests__/init.test.ts
git commit -m "feat: add ee/observability/init.ts (registerOTel + log transport wiring)"
```

---

### Task 6: Wire into `instrumentation.ts` + generalize the FOSS drift guard

**Files:**
- Modify: `instrumentation.ts`
- Modify: `scripts/__tests__/foss.test.ts`

**Interfaces:**
- Consumes: `initializeObservability` from `@/ee/observability/init` (Task 5).

- [ ] **Step 1: Run the FOSS drift guard test to see current behavior**

Run: `npx vitest run --project node scripts/__tests__/foss.test.ts`
Expected: PASS (nothing has changed yet).

- [ ] **Step 2: Update `instrumentation.ts`**

Insert the observability call between `assertConfig()` and `initializeCommercialPlans()`:

```ts
export async function register() {
  // Written as a positive branch rather than an early return so the Edge
  // compilation sees a literal `if (false) { ... }` and drops the block whole.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertConfig } = await import('@/lib/config/assert')
    assertConfig()

    // Observability (logs + traces, EE). Runs before initializeCommercialPlans
    // below — and before anything else in this function that might create the
    // Pino singleton — because registerExtraLogTransport() only works before
    // the logger is first constructed. See ee/observability/init.ts.
    const { initializeObservability } = await import('@/ee/observability/init')
    initializeObservability()

    // Plan enforcement (issue #117). Runs once per process, here rather than in
    // `app/layout.tsx` where it previously sat — that is a React Server
    // Component render function, so it re-ran on every RSC render and was
    // idempotent only by virtue of being empty.
    //
    // A no-op unless `USE_COMMERCIAL=true`; the check lives inside so a
    // self-hosted deployment never constructs a DB-backed resolver.
    //
    // NOTE for the stripped OSS build: this is a static import path, so
    // deleting `ee/` breaks the build here. The FOSS artifact needs the
    // two-entrypoint swap (an `instrumentation.foss.ts` that omits this call,
    // renamed over this file by the strip script) — the same technique
    // Rocket.Chat's `fossify` uses. Not built yet.
    const { initializeCommercialPlans } = await import('@/ee/init')
    initializeCommercialPlans()

    const { register: registerWorker } = await import('@/lib/instrumentation')
    await registerWorker()
  }
}
```

`instrumentation.foss.ts` is **not modified** — it must never import `@/ee/observability/init`.

- [ ] **Step 3: Run the FOSS drift guard test to see it fail**

Run: `npx vitest run --project node scripts/__tests__/foss.test.ts`
Expected: FAIL — the `'is the default entrypoint minus exactly the commercial import'` test now sees `main()` with two `@/ee/` imports but its filter only strips `@/ee/init`, so it expects `instrumentation.foss.ts` to also import `@/ee/observability/init`, which it correctly does not.

- [ ] **Step 4: Generalize the filter in `scripts/__tests__/foss.test.ts`**

The filter needs to exclude every `@/ee/` import, not just the one literal string, or a second EE-only dynamic import in the default entrypoint will always break this guard. Replace:

```ts
  it('imports the commercial init in the default entrypoint', () => {
    expect(dynamicImports(main())).toContain('@/ee/init')
  })
```

with:

```ts
  it('imports the commercial and observability init in the default entrypoint', () => {
    expect(dynamicImports(main())).toContain('@/ee/init')
    expect(dynamicImports(main())).toContain('@/ee/observability/init')
  })
```

Replace:

```ts
  it('does not import anything commercial in the FOSS entrypoint', () => {
    const specifiers = dynamicImports(foss())

    expect(specifiers).not.toContain('@/ee/init')
    for (const path of COMMERCIAL_PATHS) {
      expect(specifiers.some((s) => s.includes(`/${path}/`))).toBe(false)
    }
  })
```

with:

```ts
  it('does not import anything commercial in the FOSS entrypoint', () => {
    const specifiers = dynamicImports(foss())

    expect(specifiers).not.toContain('@/ee/init')
    expect(specifiers).not.toContain('@/ee/observability/init')
    for (const path of COMMERCIAL_PATHS) {
      expect(specifiers.some((s) => s.includes(`/${path}/`))).toBe(false)
    }
  })
```

Replace the drift guard itself:

```ts
  it('is the default entrypoint minus exactly the commercial import', () => {
    const expected = dynamicImports(main()).filter((s) => s !== '@/ee/init')

    expect(dynamicImports(foss())).toEqual(expected)
  })
```

with:

```ts
  /**
   * Generalized to a prefix check rather than one literal string: any dynamic
   * import under @/ee/ is a commercial boot step, and this guard exists
   * precisely so adding a second one (as observability did) can't silently
   * land in only one of the two entrypoints.
   */
  it('is the default entrypoint minus every @/ee/ import', () => {
    const expected = dynamicImports(main()).filter((s) => !s.startsWith('@/ee/'))

    expect(dynamicImports(foss())).toEqual(expected)
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project node scripts/__tests__/foss.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: PASS, no decrease in test count.

- [ ] **Step 7: Commit**

```bash
git add instrumentation.ts scripts/__tests__/foss.test.ts
git commit -m "feat: wire observability init into instrumentation.ts, generalize FOSS drift guard"
```

---

### Task 7: Manual span — LLM enrichment

**Files:**
- Modify: `lib/llm/enrichment.ts`
- Modify: `lib/llm/__tests__/enrichment.test.ts`

**Interfaces:**
- Consumes: `trace`, `SpanStatusCode` from `@opentelemetry/api` (Task 1). Does not depend on Task 5/6 — spans are no-ops with no SDK registered, so this works (silently, with zero cost) even before those tasks land.

`enrichMessage`'s existing contract (never throws, returns `boolean`) is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `lib/llm/__tests__/enrichment.test.ts`, near the top (after the existing `vi.mock` calls, before `describe('enrichMessage', ...)`):

```ts
const startActiveSpanMock = vi.fn((_name: string, fn: (span: unknown) => unknown) => {
  const fakeSpan = { setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }
  return fn(fakeSpan)
})

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>()
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: () => ({ startActiveSpan: startActiveSpanMock }) },
  }
})
```

Then add, inside `describe('enrichMessage', ...)`:

```ts
  it('wraps enrichment in an OTel span named llm.enrich_message', async () => {
    const { enrichMessage } = await import('../enrichment')
    await enrichMessage('msg-1')

    expect(startActiveSpanMock).toHaveBeenCalledWith('llm.enrich_message', expect.any(Function))
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project node lib/llm/__tests__/enrichment.test.ts`
Expected: FAIL — no span is started yet.

- [ ] **Step 3: Wrap `enrichMessage` in `lib/llm/enrichment.ts`**

Add the import and tracer at the top, rename the existing function body to `enrichMessageInner`, and add a thin wrapping `enrichMessage`:

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { prisma } from '@/lib/db'
import { CommercialProvider } from '@/lib/commercial/provider'
import { getProvider } from './factory'

const tracer = trace.getTracer('inboxui.llm')

/**
 * Best-effort LLM enrichment. Never throws (so it can't fail ingestion), but
 * returns whether the step is *settled*:
 *  - `true`  — enriched, or a definitive no-op (no provider, not entitled,
 *              already enriched, message gone). Nothing to retry.
 *  - `false` — a transient failure (provider/network error). The caller should
 *              NOT mark the step complete, so it can be re-attempted rather than
 *              permanently skipped (F19).
 */
export async function enrichMessage(messageId: string): Promise<boolean> {
  return tracer.startActiveSpan('llm.enrich_message', async (span) => {
    span.setAttribute('inboxui.message_id', messageId)
    try {
      const settled = await enrichMessageInner(messageId)
      span.setAttribute('inboxui.enrichment.settled', settled)
      if (!settled) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'enrichment failed transiently' })
      }
      return settled
    } finally {
      span.end()
    }
  })
}

async function enrichMessageInner(messageId: string): Promise<boolean> {
  const provider = getProvider()
  if (!provider) {
    console.log('[enrichMessage] skip: no provider (LLM_PROVIDER not set or unrecognised)')
    return true
  }

  try {
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: { id: true, subject: true, text: true, metadata: true, organizationId: true },
    })
    if (!message) {
      console.log('[enrichMessage] skip: message not found', messageId)
      return true
    }

    // A plan without LLM enrichment is a *settled* skip, not a transient one:
    // retrying would produce the same answer forever, and the caller would
    // never mark the step complete.
    const plan = await CommercialProvider.plans.resolve(message.organizationId)
    if (!plan.limits.llmEnrichment) {
      console.log('[enrichMessage] skip: plan excludes llm enrichment', {
        organizationId: message.organizationId,
        planCode: plan.planCode,
      })
      return true
    }

    if (message.metadata !== null) {
      console.log('[enrichMessage] skip: already enriched', messageId)
      return true
    }

    // Metered after the idempotency check, so a re-run over an already-enriched
    // message costs nothing. Exhausting the meter is a *settled* skip like the
    // feature switch above: retrying would give the same answer until the
    // period rolls over, so the caller must mark the step done rather than
    // re-queue it indefinitely.
    const quota = await CommercialProvider.quota.consume(
      message.organizationId,
      'llm.enrichments',
      1,
      plan,
    )
    if (!quota.allowed) {
      console.log('[enrichMessage] skip: enrichment quota exhausted', {
        organizationId: message.organizationId,
        limit: quota.limit,
        used: quota.used,
      })
      return true
    }

    console.log('[enrichMessage] calling provider.enrich', messageId)
    try {
      const result = await provider.enrich(message.subject, message.text)
      console.log('[enrichMessage] done', { messageId, categories: result.categories, otp: result.extractedOtp })
      await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          categories: result.categories,
          extractedOtp: result.extractedOtp ?? null,
          metadata: result.metadata,
        },
      })
    } catch (error) {
      // The unit isn't earned until the result is actually persisted: if the
      // provider call succeeds but the update below fails, metadata stays
      // null, so a retry would call the (billable) provider again for the
      // same message unless this refunds the first attempt too.
      await CommercialProvider.quota.refund(message.organizationId, 'llm.enrichments', 1, plan)
      throw error
    }
    return true
  } catch (error) {
    // console.error intentional: pino transport may be unavailable when this fires
    console.error('[enrichMessage] LLM enrichment failed', { messageId, error })
    return false
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project node lib/llm/__tests__/enrichment.test.ts`
Expected: PASS, all cases including the pre-existing ones (the wrapper's `startActiveSpan` mock synchronously invokes the callback, so behavior is unchanged from the caller's perspective).

- [ ] **Step 5: Commit**

```bash
git add lib/llm/enrichment.ts lib/llm/__tests__/enrichment.test.ts
git commit -m "feat: wrap enrichMessage in an OTel span"
```

---

### Task 8: Manual span — async webhook job processing

**Files:**
- Modify: `lib/webhooks/worker.ts`
- Modify: `lib/webhooks/__tests__/worker.test.ts`

**Interfaces:**
- Consumes: `trace`, `SpanStatusCode` from `@opentelemetry/api` (Task 1). Independent of Tasks 5/6, same reasoning as Task 7.

This is the path worth instrumenting manually: unlike the synchronous webhook route (an HTTP request, auto-traced by `@vercel/otel`'s Next.js route-handler instrumentation once Task 5/6 are enabled), a BullMQ job has no HTTP request and therefore zero automatic tracing coverage.

`processEmailWebhookJob`'s existing contract (throws on failure, so BullMQ retries) is unchanged.

- [ ] **Step 1: Write the failing test**

This file re-declares its `vi.mock` calls inside `freshImport()` after every `vi.resetModules()` (see that function's existing body) — the new OTel mock needs the same treatment to survive a fresh import. Add the mock and spy near the top of `lib/webhooks/__tests__/worker.test.ts`, right after the `MockRedis`/`vi.mock('ioredis', ...)` block and before the Prisma mock:

```ts
// ---------------------------------------------------------------------------
// @opentelemetry/api mock — captures the span the worker starts
// ---------------------------------------------------------------------------

const startActiveSpanMock = vi.fn((_name: string, fn: (span: unknown) => unknown) => {
  const fakeSpan = { setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() };
  return fn(fakeSpan);
});

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();
  return {
    ...actual,
    trace: { ...actual.trace, getTracer: () => ({ startActiveSpan: startActiveSpanMock }) },
  };
});
```

Add the same `vi.mock('@opentelemetry/api', ...)` call (identical body) inside `freshImport()`, alongside its existing re-applied mocks (`vi.mock('bullmq', ...)`, `vi.mock('ioredis', ...)`, etc.), so it survives `vi.resetModules()` there too.

Then add a new `describe` block after `describe('Job Processing — happy path', ...)`, using the same `makeJob()`/`capturedProcessor` pattern those tests already use:

```ts
  describe('Job Processing — tracing', () => {
    it('wraps job processing in an OTel span named webhook.process_email_job', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockStoreIncomingEmail.mockResolvedValueOnce([{ id: 'msg_1' }]);

      const { getEmailWebhookWorker } = await freshImport();
      getEmailWebhookWorker();

      await capturedProcessor!(makeJob());

      expect(startActiveSpanMock).toHaveBeenCalledWith(
        'webhook.process_email_job',
        expect.any(Function),
      );
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project node lib/webhooks/__tests__/worker.test.ts`
Expected: FAIL — no span is started yet.

- [ ] **Step 3: Wrap `processEmailWebhookJob` in `lib/webhooks/worker.ts`**

Add the import and tracer near the top of the file (alongside the existing imports), rename the current function to `processEmailWebhookJobInner`, and add a thin wrapping `processEmailWebhookJob` with the original name and signature — the `new Worker<EmailWebhookJobData>(..., processEmailWebhookJob, ...)` call site does not need to change:

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('inboxui.webhooks');

async function processEmailWebhookJob(
  job: Job<EmailWebhookJobData>,
): Promise<void> {
  return tracer.startActiveSpan('webhook.process_email_job', async (span) => {
    span.setAttribute('inboxui.job_id', job.id ?? '');
    span.setAttribute('inboxui.external_id', job.data.externalId);
    span.setAttribute('inboxui.inbox_email_address_id', job.data.inboxEmailAddressId);
    try {
      await processEmailWebhookJobInner(job);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

Rename the existing `async function processEmailWebhookJob(job: Job<EmailWebhookJobData>): Promise<void> { ... }` (the one with the full body) to `processEmailWebhookJobInner`, keeping its body byte-for-byte identical — only the function name changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project node lib/webhooks/__tests__/worker.test.ts`
Expected: PASS, all cases including the pre-existing ones — the mocked `startActiveSpan` synchronously invokes its callback and returns its result, so `capturedProcessor` (still bound to the outer `processEmailWebhookJob`) behaves exactly as before to every existing test.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS, no decrease in test count.

- [ ] **Step 6: Commit**

```bash
git add lib/webhooks/worker.ts lib/webhooks/__tests__/worker.test.ts
git commit -m "feat: wrap processEmailWebhookJob in an OTel span"
```

---

### Task 9: Documentation

**Files:**
- Create: `docs/architecture/observability.md`
- Create: `docs/observability-operator-guide.md`
- Modify: `docs/logging.md`
- Modify: `deploy/README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: exact names and paths from every prior task — `ENABLE_OBSERVABILITY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `ee/observability/init.ts`, `initializeObservability()`, `registerExtraLogTransport()`, `trace_id`/`span_id`.

No test cycle — this is a documentation-only task, reviewed for accuracy against the code from Tasks 1–8 rather than run.

- [ ] **Step 1: Write `docs/architecture/observability.md`**

Mirror `docs/architecture/commercial-layer.md`'s structure and depth. Required sections and content:

- **Overview**: what this ships (log search + tracing), that it's EE/SaaS-only, that it exports directly over OTLP with no bundled Grafana/Loki/Tempo and no sidecar container.
- **The gate**: build-time (`ee/observability/`, covered by the existing `ee` entry in `scripts/foss.mjs`'s `COMMERCIAL_PATHS` since it's nested under `ee/` — no change to that array was needed) plus runtime (`ENABLE_OBSERVABILITY`, default `false`, independent of `USE_COMMERCIAL`). State explicitly: setting the flag on a Community build is inert, because the code that reads `config.observability` does not exist there.
- **Traces**: `@vercel/otel`'s `registerOTel()`, called from `ee/observability/init.ts`'s `initializeObservability()`, itself called from the root `instrumentation.ts`. Auto-instruments Next.js route handlers and outgoing `fetch`. Manual spans: `llm.enrich_message` (`lib/llm/enrichment.ts`) and `webhook.process_email_job` (`lib/webhooks/worker.ts`, the one execution path with no automatic HTTP-level tracing since a BullMQ job is not an HTTP request). No sampling in this phase — always-on.
- **Logs**: two independent, additive pieces. (1) Trace-log correlation — the Pino `mixin` in `lib/logger.config.ts`, using only `@opentelemetry/api`, unconditional and community-safe since it no-ops with no SDK registered. (2) Log shipping — `registerExtraLogTransport()` in `lib/logger.config.ts`, called only from `ee/observability/init.ts`, adds a `pino-opentelemetry-transport` target alongside the existing stdout JSON output (via `pino/file` destination 1 in production) so `docker logs` is unaffected either way.
- **Ordering constraint**: `registerExtraLogTransport()` must run before the first `getLogger()`/`logger.*` call in the process, since Pino cannot add a transport after construction. State the exact call order in `instrumentation.ts`: `assertConfig()` → `initializeObservability()` → `initializeCommercialPlans()` (the first thing that would otherwise create the logger singleton) → worker registration.
- **Why generic OTel env vars, not Grafana-specific config**: `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS`/`OTEL_SERVICE_NAME` are standard OpenTelemetry SDK environment variables, read directly by `@vercel/otel` and `pino-opentelemetry-transport` from `process.env` — never re-plumbed through `config.observability`, which exists purely for `assertConfig()`'s boot-time validation. Any OTLP-compatible backend works; Grafana Cloud is documentation, not code.
- **Build note**: `pino-opentelemetry-transport` is externalized in `next.config.mjs` alongside `pino-pretty`/`thread-stream`, and the standalone build's file-tracing was verified (or given `outputFileTracingIncludes`, per Task 4 Step 3's actual outcome — state which one actually happened).
- **Out of scope**: metrics, self-hosted Grafana/Loki/Tempo as an alternative backend, trace sampling, Prisma-level spans.

- [ ] **Step 2: Write `docs/observability-operator-guide.md`**

Mirror `docs/async-webhook-processing-operator-guide.md`'s structure: Overview → Prerequisites → Environment Setup → Verification → Troubleshooting. Required content:

- **Overview**: one paragraph, what an operator gets and that this is EE/SaaS-only.
- **Note for Community Edition readers**, near the top: this guide only applies to the EE/SaaS build; `docs/` is not stripped by `scripts/foss.mjs` (only code under `ee/` is), so this file remains visible in a Community checkout even though following it does nothing there. Link to `docs/architecture/commercial-layer.md`.
- **Prerequisites**: a free Grafana Cloud account (or any OTLP-compatible backend).
- **Environment Setup**, as concrete numbered steps:
  1. Create a Grafana Cloud stack (or use an existing one).
  2. In the stack, go to **Connections → Add new connection → OpenTelemetry (OTLP)** and copy the OTLP gateway URL shown there — this is `OTEL_EXPORTER_OTLP_ENDPOINT`.
  3. Generate an API token from the same page (or **Administration → API Keys**) with metrics/logs/traces write scope.
  4. Build the Basic auth header value: `echo -n "<instanceID>:<token>" | base64`, then set `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <that base64 string>`.
  5. Set `ENABLE_OBSERVABILITY=true` and, optionally, `OTEL_SERVICE_NAME` (defaults to `inboxui`).
  6. Add all four to `/srv/inboxui/secrets/app.env` (self-hosted) and restart the `app` service — `docker compose restart app` (no other services need restarting; no migration).
- **Verification**: a request through the app produces a trace in Grafana's Explore view (select the Tempo/Traces data source); the corresponding log lines appear in the Loki/Logs data source carrying `trace_id`/`span_id` fields that match the trace; clicking a span in Grafana's trace view can jump to its correlated logs.
- **Troubleshooting**, exactly two entries:
  - *App won't start after setting `ENABLE_OBSERVABILITY=true`*: `assertConfig()` is refusing to boot because `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_HEADERS` is missing or malformed — the error names the variable. Fix: fill it in, or set the flag back to `false`.
  - *App boots fine, but nothing appears in Grafana*: the endpoint/headers are wrong (typo, expired token, wrong region gateway) — this fails silently by design, since a broken exporter must never take down request handling. Fix: double-check the values against the Grafana Cloud connection page and confirm the token hasn't expired.

- [ ] **Step 3: Add a section to `docs/logging.md`**

Insert a new `## Shipping logs externally (EE)` section near the end of the file (after "Common patterns", before "Testing"). Content: state that every log line carries `trace_id`/`span_id` fields whenever it's emitted during an active OpenTelemetry span (harmless and absent otherwise); that shipping logs to an external backend is an EE/SaaS feature controlled by `ENABLE_OBSERVABILITY`; and link to `docs/observability-operator-guide.md` for setup rather than duplicating it here.

- [ ] **Step 4: Add "Part 9" to `deploy/README.md`**

Insert after the existing "Part 8 — Wire up inbound email (Resend)" section, before "Day-to-day deploys":

```
## Part 9 — Observability: log search & tracing (EE, optional)

No new containers. Add the four vars from the "Observability" section of
`.env.example` to `/srv/inboxui/secrets/app.env` from Part 3, then:

    sudo -u deploy docker compose -f docker-compose.yml restart app

Full setup (getting the endpoint/headers from Grafana Cloud's free tier) is in
docs/observability-operator-guide.md.
```

- [ ] **Step 5: Update `CLAUDE.md`**

Add `ENABLE_OBSERVABILITY` to the "Optional, with defaults" bullet list in the "Required env vars" section (default `false`), and add a new paragraph after the `EMAIL_INBOX_DOMAINS` paragraph in that same section documenting the conditional requirement:

> `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_SERVICE_NAME` follow the same conditional-requirement pattern as `EMAIL_LINK_SECRET`/`APP_BASE_URL`: `null`/default by default, and the first two are required and asserted at boot whenever `ENABLE_OBSERVABILITY=true`. Unlike most conditionally-required vars, `ee/observability/init.ts` never reads their *values* back out of `config` — the standard-named OTel env vars are read directly by the OTel exporters, so `config.observability`'s role is purely boot-time validation.

Add a new subsection under "Architecture", after the "MCP server" subsection:

```markdown
### Observability: log search & tracing (EE)

EE/SaaS-only — build-time gated the same way as billing: the wiring lives in
`ee/observability/`, stripped from Community builds by `scripts/foss.mjs`
(covered by the existing `ee` entry in `COMMERCIAL_PATHS`, since it's nested
under `ee/` — no separate entry was needed). A second, independent runtime
flag, `ENABLE_OBSERVABILITY` (default `false`), means it's off even on an EE
build until an operator turns it on — not tied to `USE_COMMERCIAL`, since a
self-hosted EE deployment without Stripe billing should still be able to
enable it.

Ships logs and traces directly from the running container over OTLP — no
bundled Grafana/Loki/Tempo, no sidecar container. `docs/architecture/observability.md`
covers the design; `docs/observability-operator-guide.md` covers self-hosted
setup (Grafana Cloud's free tier is the reference backend, but the code is
vendor-neutral — any OTLP-compatible endpoint works, since
`OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS` are standard
OpenTelemetry SDK env vars, not Grafana-specific ones).

Two independent pieces, split shared-vs-EE the same way commercial enforcement
is: trace-log correlation (`lib/logger.config.ts`'s Pino `mixin`, using only
`@opentelemetry/api`) is unconditional and inert without a registered SDK, so
it's safe in Community code. Actually registering the SDK
(`ee/observability/init.ts`'s `initializeObservability()`, called from the
root `instrumentation.ts`) is EE-only. `registerExtraLogTransport()` in
`lib/logger.config.ts` must be called before the first `getLogger()`/`logger.*`
call in the process — Pino has no API to add a transport after construction —
which is why `initializeObservability()` runs immediately after
`assertConfig()`, before `initializeCommercialPlans()` (the first thing that
would otherwise create the logger singleton).

Manual spans cover the one execution path with no automatic tracing:
`processEmailWebhookJob` in `lib/webhooks/worker.ts` (a BullMQ job, not an
HTTP request). The synchronous webhook route and every other API route get
tracing for free from `@vercel/otel`'s Next.js instrumentation.
```

- [ ] **Step 6: Review all five files for accuracy**

Re-read `ee/observability/init.ts`, `lib/logger.config.ts`, and `instrumentation.ts` as they exist after Tasks 3, 5, and 6, and confirm every path, function name, and ordering claim in the five doc files from this task matches the actual code — particularly the Task 4 Step 3 outcome (whether `outputFileTracingIncludes` was actually needed).

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/observability.md docs/observability-operator-guide.md docs/logging.md deploy/README.md CLAUDE.md
git commit -m "docs: add EE observability architecture doc and self-hosted operator guide"
```

---

## Self-Review Notes

- **Spec coverage**: build-time + runtime gate (Task 2, 5, 6), traces via `@vercel/otel` (Task 5), logs + correlation (Task 3), manual spans on webhook ingest + LLM enrichment (Task 7, 8), no new Docker services (confirmed — `deploy/docker-compose.yml`'s `env_file` pass-through means no compose edit is needed, per Task 9 Step 4), documentation split into architecture doc + operator guide (Task 9). No sampling (not built, per Global Constraints). Metrics, self-hosted Grafana/Loki/Tempo, Prisma spans — explicitly out of scope, documented as such in Task 9.
- **Type consistency**: `registerExtraLogTransport(target: TransportTargetOptions): void` (Task 3) matches its call in `ee/observability/init.ts` (Task 5) and its test signature (Task 3's own tests). `config.observability.{enabled,otlpEndpoint,otlpHeaders,serviceName}` (Task 2) matches every read site (Task 5, Task 9's doc claims). `initializeObservability(): void` (Task 5) matches its only call site (Task 6).
- **Ordering dependency called out explicitly**: Task 6 Step 2's placement of `initializeObservability()` before `initializeCommercialPlans()` is the one genuinely load-bearing ordering constraint in this plan, and it's documented in three places (Task 3's `registerExtraLogTransport` comment, Task 5's function doc, Task 9's CLAUDE.md subsection) so it survives a future refactor that only reads one of them.
