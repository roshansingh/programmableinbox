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
 *
 * The whole body is Node-only. Next runs this hook once per runtime, and
 * `proxy.ts` gives the app an Edge runtime too — where neither branch can even
 * be parsed: `lib/config/secret.ts` imports `node:util` for its `inspect` hook,
 * and the worker reaches `node:https` through `lib/security/ssrf-guard` plus
 * ioredis through the queue. The `NEXT_RUNTIME` guard is what keeps that out of
 * the Edge bundle: the bundler inlines the value per compilation, so this
 * branch is dead code there and its dynamic imports are never followed. Nothing
 * is lost — the Edge runtime here only serves `proxy.ts`, which reads no
 * config, and the Node runtime still fails loudly at boot on a bad variable.
 */
export async function register() {
  // Written as a positive branch rather than an early return so the Edge
  // compilation sees a literal `if (false) { ... }` and drops the block whole.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertConfig } = await import('@/lib/config/assert')
    assertConfig()

    // Observability (logs + traces, EE). Runs before initializeCommercialPlans
    // below — and before anything else in this function that might create the
    // Pino singleton — because registerExtraLogTransport() only works before
    // the logger is first constructed. See ee/observability/init.ts.
    const { initializeObservability } = await import('@/ee/observability/init')
    initializeObservability()

    // Plan enforcement (issue #117). Runs once per process, here rather than in
    // `app/layout.tsx` where it previously sat — that is a React Server
    // Component render function, so it re-ran on every RSC render and was
    // idempotent only by virtue of being empty.
    //
    // A no-op unless `USE_COMMERCIAL=true`; the check lives inside so a
    // self-hosted deployment never constructs a DB-backed resolver.
    //
    // NOTE for the stripped OSS build: this is a static import path, so
    // deleting `ee/` breaks the build here. The FOSS artifact needs the
    // two-entrypoint swap (an `instrumentation.foss.ts` that omits this call,
    // renamed over this file by the strip script) — the same technique
    // Rocket.Chat's `fossify` uses. Not built yet.
    const { initializeCommercialPlans } = await import('@/ee/init')
    initializeCommercialPlans()

    const { register: registerWorker } = await import('@/lib/instrumentation')
    await registerWorker()
  }
}
