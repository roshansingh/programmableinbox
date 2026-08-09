import type { IPlanResolver, IQuota, IMetering } from './interfaces'
import { UnlimitedPlanResolver } from './oss/UnlimitedPlanResolver'
import { NoopQuota } from './oss/NoopQuota'
import { NoopMetering } from './oss/NoopMetering'

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
  private static _plans: IPlanResolver | undefined
  private static _quota: IQuota | undefined
  private static _metering: IMetering | undefined

  /** Lazily falls back to the OSS default on first access. */
  static get plans(): IPlanResolver {
    if (!this._plans) {
      this._plans = new UnlimitedPlanResolver()
    }
    return this._plans
  }

  static get quota(): IQuota {
    if (!this._quota) {
      this._quota = new NoopQuota()
    }
    return this._quota
  }

  static get metering(): IMetering {
    if (!this._metering) {
      this._metering = new NoopMetering()
    }
    return this._metering
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
    this._plans = plans
    this._quota = quota
    this._metering = metering
  }

  /** Reset to uninitialised, so the next access lazily re-loads the defaults. */
  static reset(): void {
    this._plans = undefined
    this._quota = undefined
    this._metering = undefined
  }
}
