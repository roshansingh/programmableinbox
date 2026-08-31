import type { LoggerOptions, TransportTargetOptions } from 'pino'
import pino from 'pino'
import { context, trace } from '@opentelemetry/api'
import { config } from '@/lib/config'

// Backed by `globalThis`, not module scope. In a production Next.js build,
// webpack can compile this same source file into multiple separate bundled
// copies across different entry points/chunks — confirmed empirically by
// grepping `.next/server` for a string literal unique to this file and
// finding it duplicated across 3 different compiled files. A module-scope
// `const`/`let` would then mean `instrumentation.ts`'s copy and an API
// route's copy are two different arrays with two different `built` flags:
// `registerExtraLogTransport()` would push into an array nobody else ever
// reads, and log shipping would silently become a no-op with no error
// anywhere. `globalThis` is the one true JS global shared by the whole
// Node.js process no matter how webpack chunks the code — the same reason
// `lib/db.ts` stashes its Prisma singleton there (`globalForPrisma`) to
// survive Next.js dev-mode module duplication.
const globalForLoggerConfig = globalThis as unknown as {
  __programmableinboxExtraLogTransportTargets?: TransportTargetOptions[]
  __programmableinboxLoggerConfigBuilt?: boolean
}

function getExtraTransportTargets(): TransportTargetOptions[] {
  if (!globalForLoggerConfig.__programmableinboxExtraLogTransportTargets) {
    globalForLoggerConfig.__programmableinboxExtraLogTransportTargets = []
  }
  return globalForLoggerConfig.__programmableinboxExtraLogTransportTargets
}

/**
 * Clears the global-backed extra-transport list and built flag.
 *
 * Test seam only — not used in production. `vi.resetModules()` gives a test a
 * pristine module instance, but it does NOT clear `globalThis`, so without
 * this the state above would leak between tests in the same file. Call this
 * alongside `vi.resetModules()` in `afterEach`.
 */
export function resetLoggerConfigStateForTests(): void {
  globalForLoggerConfig.__programmableinboxExtraLogTransportTargets = []
  globalForLoggerConfig.__programmableinboxLoggerConfigBuilt = false
}

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
 *
 * The registered-targets list and the "already built" flag both live on
 * `globalThis` (see above) rather than module scope, specifically because a
 * module-scoped array would not survive webpack's per-chunk duplication in a
 * production build — this file can be compiled into more than one bundled
 * copy, and only a process-global survives that.
 */
export function registerExtraLogTransport(target: TransportTargetOptions): void {
  if (globalForLoggerConfig.__programmableinboxLoggerConfigBuilt) {
    throw new Error(
      'registerExtraLogTransport() called after the logger was already built — ' +
        'it must run before the first getLogger()/logger.* call in the process. ' +
        'See ee/observability/init.ts and its ordering in instrumentation.ts.',
    )
  }
  getExtraTransportTargets().push(target)
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
  globalForLoggerConfig.__programmableinboxLoggerConfigBuilt = true

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

  const extraTransportTargets = getExtraTransportTargets()

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
