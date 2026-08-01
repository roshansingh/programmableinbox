/**
 * Next.js instrumentation entry point.
 *
 * Next only loads `instrumentation.ts` from the project root (or `src/`), which
 * is why `lib/instrumentation.ts` — where the webhook worker bootstrap has
 * lived — has never actually run: nothing imported it. This file is the real
 * hook.
 *
 * Configuration is validated first so a misconfigured deployment fails at boot
 * with one aggregated report, rather than at whichever request first touches
 * the broken variable.
 */
export async function register() {
  const { assertConfig } = await import('@/lib/config/assert')
  assertConfig()

  const { register: registerWorker } = await import('@/lib/instrumentation')
  await registerWorker()
}
