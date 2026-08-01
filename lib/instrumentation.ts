/**
 * Next.js instrumentation hook for initializing the async webhook worker.
 *
 * This file is loaded by Next.js on server startup (before any requests are
 * processed), ensuring the worker is running and ready to process jobs.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  const { assertConfig } = await import('@/lib/config')

  // Validate all environment variables at server boot. Reports every problem
  // at once (rather than one per request) and fails loudly with a clear message
  // listing each misconfigured variable.
  assertConfig()

  const { config } = await import('@/lib/config')

  // Only initialize the worker if async webhook processing is enabled.
  if (!config.runtime.asyncWebhookProcessing) {
    return
  }

  const { startEmailWebhookWorker } = await import('@/lib/webhooks/worker')

  try {
    await startEmailWebhookWorker()
    console.log('[instrumentation] Email webhook worker initialized')
  } catch (error) {
    console.error('[instrumentation] Failed to initialize email webhook worker:', error)
    // Don't throw — allow the server to start even if worker initialization fails.
    // The worker will be retried on the first health check.
  }
}
