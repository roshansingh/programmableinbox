import { registerOTel } from '@vercel/otel'
import { config } from '@/lib/config'
import logger from '@/lib/logger'

/**
 * Installs OpenTelemetry tracing (EE observability). Log export is not part
 * of this: logs ship by the collector's `filelog` receiver tailing this
 * container's Docker stdout (json-file driver) and parsing Pino's JSON lines
 * — see `deploy/otel-collector.yaml` and docs/architecture/observability.md.
 * That keeps log delivery independent of this process ever getting a chance
 * to flush an in-process exporter before exit.
 *
 * Called once at process start from the root `instrumentation.ts`.
 *
 * A no-op unless `ENABLE_OBSERVABILITY` is true, which is what makes deleting
 * `ee/` (the Community build) behave identically to leaving the flag off:
 * `registerOTel()` is never called.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is never read from `config.observability`
 * here — `assertConfig()` already required it to be present and well-formed
 * when the flag is on, but the actual value is picked up directly from
 * `process.env` by `@vercel/otel`, which follows the standard OpenTelemetry
 * SDK environment-variable convention. Re-plumbing it through our config
 * object into a constructor option would just be a second, redundant path to
 * the same value.
 */
export function initializeObservability(): void {
  if (!config.observability.enabled) {
    return
  }

  registerOTel(config.observability.serviceName)

  logger.info('[observability] OpenTelemetry tracing enabled')
}
