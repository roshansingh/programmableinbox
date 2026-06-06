import { IPolicy, IEntitlements, IMetering } from './interfaces'
import { AllowAllPolicy } from './oss/AllowAllPolicy'
import { EnableAllEntitlements } from './oss/EnableAllEntitlements'
import { NoopMetering } from './oss/NoopMetering'

/**
 * CommercialProvider: Static service locator for commercial implementations.
 *
 * Default behavior (OSS):
 *   - policy: AllowAllPolicy (allows all operations)
 *   - entitlements: EnableAllEntitlements (enables all features)
 *   - metering: NoopMetering (discards metrics)
 *
 * SaaS override (billing app calls configure()):
 *   - policy: StrictPolicy (enforces Stripe limits)
 *   - entitlements: PlanEntitlements (tier-based features)
 *   - metering: StripeMetering (records to Stripe)
 */
export class CommercialProvider {
  private static _policy: IPolicy | undefined
  private static _entitlements: IEntitlements | undefined
  private static _metering: IMetering | undefined

  /**
   * Get the current policy implementation.
   * On first access, lazily loads AllowAllPolicy (OSS default).
   */
  static get policy(): IPolicy {
    if (!this._policy) {
      this._policy = new AllowAllPolicy()
    }
    return this._policy
  }

  /**
   * Get the current entitlements implementation.
   * On first access, lazily loads EnableAllEntitlements (OSS default).
   */
  static get entitlements(): IEntitlements {
    if (!this._entitlements) {
      this._entitlements = new EnableAllEntitlements()
    }
    return this._entitlements
  }

  /**
   * Get the current metering implementation.
   * On first access, lazily loads NoopMetering (OSS default).
   */
  static get metering(): IMetering {
    if (!this._metering) {
      this._metering = new NoopMetering()
    }
    return this._metering
  }

  /**
   * Configure custom implementations (called by SaaS billing app at startup).
   *
   * @example
   * // In inboxui-billing/lib/init.ts:
   * CommercialProvider.configure(
   *   new StrictPolicy(stripe, plans),
   *   new PlanEntitlements(plans),
   *   new StripeMetering(stripe)
   * )
   */
  static configure(policy: IPolicy, entitlements: IEntitlements, metering: IMetering): void {
    this._policy = policy
    this._entitlements = entitlements
    this._metering = metering
  }

  /**
   * Reset to uninitialized state (primarily for testing).
   * Forces lazy-loading of defaults on next access.
   */
  static reset(): void {
    this._policy = undefined
    this._entitlements = undefined
    this._metering = undefined
  }
}
