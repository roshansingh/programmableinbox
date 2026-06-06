import { IPolicy, PolicyCheckRequest, PolicyCheckResult } from '../interfaces'

/**
 * OSS implementation: Always allows all operations.
 * Used when billing is disabled (default for OSS release).
 */
export class AllowAllPolicy implements IPolicy {
  async check(request: PolicyCheckRequest): Promise<PolicyCheckResult> {
    return { allowed: true }
  }
}
