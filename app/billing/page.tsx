"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import {
  createBillingPortalSession,
  createCheckoutSession,
  getPublicPlans,
  type PublicPlan,
} from "@/lib/api/billing.api"
import { cn } from "@/lib/utils"

function formatPrice(price: PublicPlan["price"]): string {
  if (!price) return "Free"
  const amount = (price.amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  })
  return `${amount}/${price.interval}`
}

/**
 * `singular`/`plural` are passed explicitly rather than derived (e.g. by
 * stripping a trailing "s") because a unit like "incoming emails / month"
 * isn't a single pluralizable word — a suffix rule would need to know it's
 * "emails" specifically, inside a longer phrase.
 */
function formatCount(count: number | null, singular: string, plural: string): string {
  if (count === null) return `Unlimited ${plural}`
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

/**
 * How long to wait before re-checking the session after a checkout redirect.
 *
 * Stripe sends the browser to `success_url` as soon as payment settles, but
 * the webhook that actually writes the `Subscription` row is a separate,
 * asynchronous call from Stripe's backend — it can still be in flight when
 * this page mounts, so the first `/auth/me` refetch can show the pre-checkout
 * plan. One retry after a short delay covers the common case; if the webhook
 * is slower than that, a manual reload picks up the change once it lands.
 */
const CHECKOUT_CONFIRM_DELAY_MS = 1200

/**
 * Plan picker (issue #120 billing page).
 *
 * There is no downgrade route: cancelling a Pro subscription happens through
 * Stripe's Billing Portal, reached from the Pro card itself, and the
 * subscription webhook is what moves the organization back to Free once that
 * completes — see `docs/architecture/commercial-layer.md`. The Free card
 * therefore never offers an action when it isn't the current plan; there is
 * nothing this page can start on its behalf.
 */
function BillingContent() {
  const searchParams = useSearchParams()
  const { plan, organizationId, refreshUser } = useAuth()
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [confirmingCheckout, setConfirmingCheckout] = useState(false)

  useEffect(() => {
    if (!plan) {
      setLoading(false)
      return
    }
    getPublicPlans()
      .then((response) => setPlans(response.plans))
      .catch(() => setError("Could not load plans"))
      .finally(() => setLoading(false))
  }, [plan])

  useEffect(() => {
    if (searchParams.get("checkout") !== "success") return

    // Scrubbed immediately so a later reload of this URL doesn't re-trigger
    // the confirmation retry.
    window.history.replaceState(null, "", window.location.pathname)

    let cancelled = false
    setConfirmingCheckout(true)
    refreshUser()
      .then(() => new Promise((resolve) => setTimeout(resolve, CHECKOUT_CONFIRM_DELAY_MS)))
      .then(() => (cancelled ? undefined : refreshUser()))
      .finally(() => {
        if (!cancelled) setConfirmingCheckout(false)
      })

    return () => {
      cancelled = true
    }
    // Empty deps: this runs once for the checkout redirect, and the URL is
    // scrubbed immediately, so there is nothing to re-trigger on.
  }, [])

  const startCheckout = async (planCode: string) => {
    if (!organizationId || pendingCode) return
    setPendingCode(planCode)
    setError(null)
    try {
      const { url } = await createCheckoutSession(organizationId, planCode)
      window.location.assign(url)
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not start checkout")
      setPendingCode(null)
    }
  }

  const openBillingPortal = async () => {
    if (!organizationId || pendingCode) return
    setPendingCode("portal")
    setError(null)
    try {
      const { url } = await createBillingPortalSession(organizationId)
      window.location.assign(url)
    } catch (err) {
      setError((err as { message?: string }).message ?? "Could not open the billing portal")
      setPendingCode(null)
    }
  }

  function renderAction(planSummary: PublicPlan, isCurrent: boolean) {
    if (isCurrent) {
      if (planSummary.code === "free") {
        return (
          <Button variant="outline" disabled>
            Current plan
          </Button>
        )
      }
      return (
        <Button variant="outline" onClick={openBillingPortal} disabled={pendingCode !== null}>
          {pendingCode === "portal" ? "Opening…" : "Manage billing"}
        </Button>
      )
    }

    // Free has no purchase step and no downgrade route from this page —
    // cancelling the Pro plan (above) is what returns an organization to Free.
    if (planSummary.code === "free") return null

    if (planSummary.price === null) {
      return (
        <Button variant="outline" disabled>
          Not available yet
        </Button>
      )
    }

    return (
      <Button onClick={() => startCheckout(planSummary.code)} disabled={pendingCode !== null}>
        {pendingCode === planSummary.code ? "Starting checkout…" : `Upgrade to ${planSummary.name}`}
      </Button>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="mx-auto max-w-3xl space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Billing</h1>
              <p className="text-sm text-muted-foreground">Choose the plan that fits your organization.</p>
            </div>

            {!plan ? (
              <p className="text-sm text-muted-foreground">Billing is not available for this deployment.</p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">Loading plans…</p>
            ) : (
              <>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                {confirmingCheckout && (
                  <p className="text-sm text-muted-foreground" role="status">
                    Confirming your subscription…
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {plans.map((planSummary) => {
                    const isCurrent = plan.code === planSummary.code
                    return (
                      <Card key={planSummary.code} className={cn(isCurrent && "border-primary")}>
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle>{planSummary.name}</CardTitle>
                            {isCurrent && <Badge>Current plan</Badge>}
                          </div>
                          <CardDescription>{formatPrice(planSummary.price)}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            <li>
                              {formatCount(planSummary.limits.emailInboxes, "email inbox", "email inboxes")}
                            </li>
                            <li>
                              {formatCount(
                                planSummary.limits.incomingEmailsPerPeriod,
                                "incoming email / month",
                                "incoming emails / month",
                              )}
                            </li>
                            <li>{planSummary.limits.outboundEmail ? "Outbound email" : "No outbound email"}</li>
                            <li>{planSummary.limits.llmEnrichment ? "AI enrichment" : "No AI enrichment"}</li>
                          </ul>
                          {renderAction(planSummary, isCurrent)}
                          {!isCurrent && planSummary.code === "free" && (
                            <p className="text-xs text-muted-foreground">
                              Cancel your Pro plan to switch back to Free.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default function BillingPage() {
  // useSearchParams needs a Suspense boundary to keep this page statically
  // prerenderable, the same shape /auth/verify and /auth/login use for their
  // own search-param reads.
  return (
    <Suspense fallback={null}>
      <BillingContent />
    </Suspense>
  )
}
