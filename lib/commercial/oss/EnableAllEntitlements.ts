import { IEntitlements, EntitlementCheckRequest } from '../interfaces'

/**
 * OSS implementation: All features enabled for all organizations.
 * Used when billing is disabled (default for OSS release).
 */
export class EnableAllEntitlements implements IEntitlements {
  async canUse(request: EntitlementCheckRequest): Promise<boolean> {
    return true
  }
}
