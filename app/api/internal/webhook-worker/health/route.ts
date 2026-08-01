/**
 * Health check endpoint for the BullMQ email webhook worker.
 *
 * Returns 200 when the worker singleton is active (not paused), 503 otherwise.
 * This is an internal endpoint used for monitoring and for triggering worker
 * initialization on app startup (via WebhookWorkerInit in the layout).
 *
 * No auth is required — the endpoint exposes no user data, only operational state.
 */

import { getEmailWebhookWorker } from "@/lib/webhooks/worker";
import { jsonSuccess, jsonError } from "@/lib/api-helpers";
import { config } from "@/lib/config";
import { NextResponse } from "next/server";

export async function GET() {
  // Only expose health check when async webhook processing is enabled.
  if (!config.webhooks.asyncProcessingEnabled) {
    return jsonError('async webhook processing is disabled', 503);
  }

  try {
    const worker = getEmailWebhookWorker();

    // `isPaused()` is a method on BullMQ Worker that reflects whether the
    // worker has been explicitly paused via worker.pause().
    // A freshly-created worker starts in the running state (isPaused() = false).
    const isRunning = !worker.isPaused();

    if (isRunning) {
      return jsonSuccess({
        status: "healthy",
        worker: "running",
        timestamp: new Date().toISOString(),
      });
    } else {
      return jsonError('worker is paused', 503);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return jsonError(`worker error: ${errorMessage}`, 503);
  }
}
