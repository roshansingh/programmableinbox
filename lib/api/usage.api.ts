/**
 * Usage API module (issue #117 §7c).
 *
 * Live counters, kept separate from `/auth/me` because that route is fetched
 * once on mount and cached in `AuthProvider` — a counter embedded there would
 * be stale immediately. Plan *limits* ride the session; usage is polled.
 */

import { apiClient } from '../api-client'
import type { OrganizationPlan } from './auth.api'

export interface MetricUsage {
  metric: string
  /** `null` is unlimited. Zero is a real limit meaning "none allowed". */
  limit: number | null
  used: number
  /** ISO 8601, or `null` when the metric has no period. */
  resetsAt: string | null
}

export interface UsageResponse {
  organizationId: string
  plan: OrganizationPlan
  usage: MetricUsage[]
}

export async function getUsage(organizationId?: string): Promise<UsageResponse> {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
  return apiClient.get<UsageResponse>(`/app/usage${query}`)
}

/**
 * Fraction of a metric consumed, in `[0, 1]`, or `null` when unlimited.
 *
 * A zero limit is fully consumed rather than a division by zero — "none
 * allowed" is at its cap by definition.
 */
export function usageRatio(entry: MetricUsage): number | null {
  if (entry.limit === null) return null
  if (entry.limit === 0) return 1
  return entry.used / entry.limit
}
