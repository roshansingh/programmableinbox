/**
 * Billing API module (issue #120).
 *
 * Both endpoints live under an `(ee)` route group and are stripped from a FOSS
 * build entirely, so a self-hosted deployment 404s here. Callers must gate on
 * `useAuth().plan` being present rather than calling and handling the failure.
 */

import { apiClient } from '../api-client'

/**
 * A plan as the billing page displays it. Mirrors the 5 fields
 * `GET /app/billing/plans` reports — the exact set that differs between
 * `free` and `pro` today, capped there deliberately so the picker stays a
 * glance rather than a spec sheet.
 */
export interface PublicPlan {
  code: string
  name: string
  limits: {
    emailInboxes: number | null
    incomingEmailsPerPeriod: number | null
    outboundEmail: boolean
    llmEnrichment: boolean
  }
  /**
   * `null` covers two cases the client does not need to tell apart: a plan
   * that is free by design, and a paid plan with no Stripe price configured
   * yet (mirrors the 503 `createCheckoutSession` gets in that same case).
   */
  price: { amount: number; currency: string; interval: string } | null
}

/** The plans an organization can choose between. */
export async function getPublicPlans(): Promise<{ plans: PublicPlan[] }> {
  return apiClient.get<{ plans: PublicPlan[] }>('/app/billing/plans')
}

/**
 * Starts a Stripe Checkout session and returns the URL to send the browser to.
 *
 * The plan is named by `code`, never by price — the server resolves the price
 * from the database, so a client cannot subscribe the organization to a price
 * of its own choosing.
 */
export async function createCheckoutSession(
  organizationId: string,
  planCode: string,
): Promise<{ url: string }> {
  return apiClient.post<{ url: string }>('/app/billing/checkout', { organizationId, planCode })
}

/** Opens Stripe's Billing Portal for card changes, invoices and cancellation. */
export async function createBillingPortalSession(
  organizationId: string,
): Promise<{ url: string }> {
  return apiClient.post<{ url: string }>('/app/billing/portal', { organizationId })
}
