import { IMetering, MeteringRequest } from '../interfaces'

/**
 * OSS implementation: No-op metering.
 * Records are discarded. Used when billing is disabled (default for OSS release).
 * This ensures metering calls are fire-and-forget with zero overhead.
 */
export class NoopMetering implements IMetering {
  async record(request: MeteringRequest): Promise<void> {
    // No-op: OSS doesn't track usage
  }
}
