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
