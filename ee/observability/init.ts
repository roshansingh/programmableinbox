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
 * the first place in the boot sequence that could create it. That function's
 * registered-targets state lives on `globalThis` rather than module scope,
 * because webpack can compile `lib/logger.config.ts` into more than one
 * bundled copy across chunks in a production build — a module-scoped array
 * would not reliably be the same array this file and an API route's copy
 * both see.
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
