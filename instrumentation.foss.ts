/**
 * The FOSS build's `instrumentation.ts`.
 *
 * Identical to the default entrypoint minus the two `@/ee/`-prefixed dynamic
 * imports (`@/ee/init` and `@/ee/observability/init`). `scripts/foss.mjs`
 * deletes `ee/` and renames this file over `instrumentation.ts`, which is
 * what makes the stripped tree buildable — the same two-entrypoint technique
 * Rocket.Chat's `fossify` script uses (`startRocketChat.ts` /
 * `startRocketChatFOSS.ts`).
 *
 * A build-time swap rather than a runtime `if`, because the goal is that no
 * commercial code exists in the artifact at all — a conditional import would
 * still pull `ee/` into the bundle.
 *
 * With no `ee/init` to call `CommercialProvider.configure()`, the OSS defaults
 * stand: every organization resolves to the unlimited `self_hosted` plan and
 * `NoopQuota` allows everything. Enforcement call sites still run — they are
 * open-source code — they simply never refuse.
 *
 * **Keep this in sync with `instrumentation.ts`.** `scripts/__tests__` asserts
 * the two differ only by the commercial block, so a change to the boot sequence
 * that lands in one file and not the other fails the suite rather than
 * silently producing a FOSS build that skips the webhook worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertConfig } = await import('@/lib/config/assert')
    assertConfig()

    const { register: registerWorker } = await import('@/lib/instrumentation')
    await registerWorker()
  }
}
