/**
 * Billing API module (issue #120).
 *
 * Both endpoints live under an `(ee)` route group and are stripped from a FOSS
 * build entirely, so a self-hosted deployment 404s here. Callers must gate on
 * `useAuth().plan` being present rather than calling and handling the failure.
 */

import { apiClient } from '../api-client'

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
