/**
 * Async webhook worker bootstrap, run on server startup before any requests are
 * processed, so the worker is ready when jobs arrive.
 *
 * Invoked from the root `instrumentation.ts` — Next only loads the hook from
 * the project root, so this module is reached through that one rather than
 * being picked up directly.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  const { config } = await import('@/lib/config')

  // Only initialize the worker if async webhook processing is enabled.
  if (!config.webhooks.asyncProcessingEnabled) {
    return
  }

  const { startEmailWebhookWorker } = await import('@/lib/webhooks/worker')
  const logger = (await import('@/lib/logger')).default

  try {
    await startEmailWebhookWorker()
    logger.info('[instrumentation] Email webhook worker initialized')
  } catch (error) {
    logger.error({ error }, '[instrumentation] Failed to initialize email webhook worker')
    // Don't throw — allow the server to start even if worker initialization fails.
    // The worker will be retried on the first health check.
  }
}
