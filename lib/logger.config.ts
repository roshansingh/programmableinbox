import type { LoggerOptions } from 'pino'
import pino from 'pino'
import { config } from '@/lib/config'

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
  }

  if (isDev) {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }
  }

  return base
}
