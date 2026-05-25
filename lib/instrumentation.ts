/**
 * Next.js instrumentation hook for initializing the async webhook worker.
 *
 * This file is loaded by Next.js on server startup (before any requests are
 * processed), ensuring the worker is running and ready to process jobs.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only initialize the worker if async webhook processing is enabled.
  if (process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING !== 'true') {
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
