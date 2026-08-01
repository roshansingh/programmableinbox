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

    const { register: registerWorker } = await import('@/lib/instrumentation')
    await registerWorker()
  }
}
