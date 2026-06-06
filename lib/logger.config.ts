import type { LoggerOptions } from 'pino'
import pino from 'pino'

/**
 * Build the Pino logger configuration based on the current environment.
 *
 * - Development: uses pino-pretty for human-readable, colorized output.
 * - Production: plain JSON output for log aggregators.
 * - Log level defaults to `debug` in development and `info` in production,
 *   but is overridden by the `LOG_LEVEL` environment variable when set.
 */
/** Pino's complete set of accepted level strings. */
const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])

export function buildLoggerConfig(): LoggerOptions {
  const isDev = process.env.NODE_ENV !== 'production'
  const rawLevel = process.env.LOG_LEVEL?.trim()
  const defaultLevel = isDev ? 'debug' : 'info'
  const level = rawLevel && VALID_LEVELS.has(rawLevel) ? rawLevel : defaultLevel

  if (rawLevel && !VALID_LEVELS.has(rawLevel)) {
    console.warn(`[logger] Invalid LOG_LEVEL "${rawLevel}"; falling back to "${defaultLevel}"`)
  }

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
