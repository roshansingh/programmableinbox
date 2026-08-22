import type { IPlanResolver, IQuota, IMetering } from './interfaces'
import { UnlimitedPlanResolver } from './oss/UnlimitedPlanResolver'
import { NoopQuota } from './oss/NoopQuota'
import { NoopMetering } from './oss/NoopMetering'

/**
 * Backed by `globalThis`, not module/class-static scope. In a production
 * Next.js build, webpack (and Turbopack in dev) can compile this same source
 * file into more than one independent bundled copy across different entry
 * points/chunks — confirmed for the analogous `lib/logger.config.ts` case by
 * grepping `.next/server` for a string unique to this file and finding it
 * duplicated across separate compiled chunks (see `lib/db.ts`'s
 * `globalForPrisma` for the original instance of this pattern in this repo).
 * `ee/init.ts`'s one-time `configure()` call, made from `instrumentation.ts`,
 * would then only be visible on *its own* copy of this class — an API route
 * handler compiled into a different chunk would read its own, never-configured
 * copy and silently fall back to the OSS defaults regardless of
 * `USE_COMMERCIAL`. `globalThis` is the one true JS global shared by the whole
 * Node.js process no matter how the bundler chunks the code.
 */
interface CommercialProviderState {
  plans?: IPlanResolver
  quota?: IQuota
  metering?: IMetering
}

const globalForCommercial = globalThis as unknown as {
  __inboxuiCommercialProvider?: CommercialProviderState
}

function state(): CommercialProviderState {
  return (globalForCommercial.__inboxuiCommercialProvider ??= {})
}

/**
 * Service locator for the commercial plan engine (issue #117 §3).
 *
 * This is the seam that lets the open-source build work with `ee/` deleted: the
 * enforcement *call sites* live in the open tree and always call through this
 * provider, while the implementations behind it are swapped at boot. With no
 * `ee/` present the OSS defaults stand and every limit is unlimited — the same
 * code path, a different implementation, rather than a second untested branch.
 *
 * Defaults (OSS):
 *   - plans:     {@link UnlimitedPlanResolver} — `self_hosted`, never hits the DB
 *   - quota:     {@link NoopQuota} — allows everything, counts nothing
 *   - metering:  {@link NoopMetering} — discards
 *
 * Commercial override, from `ee/init.ts` at boot:
 *   - plans:     DbPlanResolver (Subscription + Plan, Redis-cached)
 *   - quota:     PostgresQuota (atomic conditional upsert on usage_counters)
 *   - metering:  billing telemetry
 */
export class CommercialProvider {
  /** Lazily falls back to the OSS default on first access. */
  static get plans(): IPlanResolver {
    const s = state()
    if (!s.plans) {
      s.plans = new UnlimitedPlanResolver()
    }
    return s.plans
  }

  static get quota(): IQuota {
    const s = state()
    if (!s.quota) {
      s.quota = new NoopQuota()
    }
    return s.quota
  }

  static get metering(): IMetering {
    const s = state()
    if (!s.metering) {
      s.metering = new NoopMetering()
    }
    return s.metering
  }

  /**
   * Install the commercial implementations. Called once at boot from
   * `ee/init.ts`, via root `instrumentation.ts`.
   *
   * Deliberately all-or-nothing: a partial override would leave, say, a real
   * plan resolver reporting a 1,000-email cap while a no-op quota let every
   * message through, which reads as "enforcement is on" while enforcing
   * nothing.
   */
  static configure(plans: IPlanResolver, quota: IQuota, metering: IMetering): void {
    const s = state()
    s.plans = plans
    s.quota = quota
    s.metering = metering
  }

  /** Reset to uninitialised, so the next access lazily re-loads the defaults. */
  static reset(): void {
    const s = state()
    s.plans = undefined
    s.quota = undefined
    s.metering = undefined
  }
}
