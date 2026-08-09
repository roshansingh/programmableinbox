import type { IQuota, QuotaMetric, QuotaResult } from '../interfaces'

/**
 * OSS default: nothing is counted and nothing is refused.
 *
 * `limit: null` rather than a large number, so the UI reads "unlimited" and
 * renders no meter — a big finite number would draw a progress bar that creeps
 * toward a cap the deployment does not have.
 */
export class NoopQuota implements IQuota {
  private static readonly ALLOWED: QuotaResult = Object.freeze({
    allowed: true,
    limit: null,
    used: 0,
    resetsAt: null,
  })

  async consume(
    _organizationId: string,
    _metric: QuotaMetric,
    _quantity: number,
  ): Promise<QuotaResult> {
    return NoopQuota.ALLOWED
  }

  async refund(_organizationId: string, _metric: QuotaMetric, _quantity: number): Promise<void> {
    // Nothing was consumed, so there is nothing to give back.
  }

  async peek(_organizationId: string, _metric: QuotaMetric): Promise<QuotaResult> {
    return NoopQuota.ALLOWED
  }

  async increment(_organizationId: string, _metric: QuotaMetric, _quantity: number): Promise<void> {
    // Report-only counters are not kept when nothing is enforced.
  }
}
