"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-provider"
import { getUsage, usageRatio, type MetricUsage } from "@/lib/api/usage.api"
import { createCheckoutSession } from "@/lib/api/billing.api"

/**
 * The plan an over-quota organization is offered.
 *
 * A constant rather than a picker because there is exactly one paid plan
 * (issue #120 scope). A second one turns this into a choice, and the banner is
 * the wrong place for it — that belongs in settings.
 */
const UPGRADE_PLAN_CODE = 'pro'

/**
 * Warn this far into a metric. Deliberately well before the cap, because on a
 * `drop` plan the consequence of arriving at 100% is irreversible: inbound mail
 * is discarded and cannot be recovered by upgrading afterwards. A user who
 * first learns at 100% has already lost messages.
 */
const WARN_AT = 0.8

/**
 * How often to refetch while the dashboard is open.
 *
 * A single fetch on mount defeats the point: a tab left open crosses 80% and
 * then the cap without ever updating, and on a `drop` plan every message in
 * between is discarded irrecoverably. One minute is frequent enough to warn
 * before that matters and cheap enough to ignore — `peekMany` makes each poll
 * one plan resolution plus one indexed read, not one per metric.
 */
const POLL_INTERVAL_MS = 60_000

const METRIC_LABELS: Record<string, string> = {
  'emails.processed': 'incoming emails',
  'emails.sent': 'sent emails',
  'llm.enrichments': 'AI enrichments',
  'automation.runs': 'automation runs',
  'webhook.deliveries': 'webhook deliveries',
  'api.requests': 'API requests',
}

function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return ''
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return ''
  return ` Resets ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.`
}

/**
 * Plan usage warnings (issue #117 §7d).
 *
 * Renders nothing at all when the deployment has no plan — `useAuth().plan` is
 * null on a self-hosted install, and the absence of a plan means no
 * restrictions rather than no access.
 *
 * Usage is fetched here rather than read from the session: `/auth/me` resolves
 * once on mount, so a counter carried on it would be stale the moment it was
 * cached.
 */
export function UsageBanner() {
  const { plan, organizationId, isAuthenticated } = useAuth()
  const [usage, setUsage] = useState<MetricUsage[]>([])
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  /**
   * Sends the browser to Stripe Checkout.
   *
   * `window.location.assign` rather than a router push: the destination is
   * Stripe's domain, so this is a full navigation out of the app.
   */
  const startUpgrade = async () => {
    if (!organizationId || upgrading) return
    setUpgrading(true)
    setUpgradeError(null)
    try {
      const { url } = await createCheckoutSession(organizationId, UPGRADE_PLAN_CODE)
      window.location.assign(url)
    } catch (error) {
      // Stays on the page with a reason. A silent failure on a paid action is
      // the worst outcome — the user cannot tell whether they were charged.
      setUpgradeError((error as { message?: string }).message ?? 'Could not start checkout')
      setUpgrading(false)
    }
  }

  useEffect(() => {
    // No plan means USE_COMMERCIAL is off, so there is nothing to meter and no
    // reason to make the request at all.
    if (!plan || !organizationId || !isAuthenticated) {
      setUsage([])
      return
    }

    let cancelled = false

    const poll = () => {
      getUsage(organizationId)
        .then((response) => {
          if (!cancelled) setUsage(response.usage)
        })
        // Usage is advisory. A failed poll must never break the dashboard — the
        // server enforces the limits regardless of what this banner believes —
        // and must not stop the interval either, since the next one may succeed.
        .catch(() => {
          if (!cancelled) setUsage([])
        })
    }

    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [plan, organizationId, isAuthenticated])

  if (!plan || usage.length === 0) return null

  const dropped = usage.find((entry) => entry.metric === 'emails.dropped')?.used ?? 0
  const metered = usage.filter((entry) => entry.limit !== null)
  const exhausted = metered.filter((entry) => (usageRatio(entry) ?? 0) >= 1)
  const approaching = metered.filter((entry) => {
    const ratio = usageRatio(entry) ?? 0
    return ratio >= WARN_AT && ratio < 1
  })

  if (exhausted.length === 0 && approaching.length === 0) return null

  const dropsMail = plan.limits.overQuotaBehavior === 'drop'
  const incomingExhausted = exhausted.some((entry) => entry.metric === 'emails.processed')
  // Only offered to organizations not already on the paid plan. Someone on
  // `pro` who is over their meter needs the portal or support, not a second
  // subscription to the plan they already have.
  const canUpgrade = plan.code !== UPGRADE_PLAN_CODE

  const upgradeButton = canUpgrade ? (
    <div className="pt-1">
      <Button size="sm" onClick={startUpgrade} disabled={upgrading}>
        {upgrading ? 'Starting checkout…' : 'Upgrade'}
      </Button>
      {upgradeError && (
        <p className="pt-1 text-xs text-destructive" role="alert">
          {upgradeError}
        </p>
      )}
    </div>
  ) : null

  return (
    <div className="px-4 pt-4 sm:px-6" role="status" aria-live="polite">
      {exhausted.length > 0 && (
        <div className="mb-2 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">
              {incomingExhausted && dropsMail
                ? 'Monthly limit reached — incoming email is not being processed.'
                : `You have reached your ${plan.name} plan limit.`}
            </p>
            <p className="text-muted-foreground">
              {exhausted
                .map((entry) => `${entry.used} of ${entry.limit} ${METRIC_LABELS[entry.metric] ?? entry.metric}`)
                .join(', ')}
              .
              {/* The number that actually motivates an upgrade: "at your limit"
                  says nothing about how much mail was lost. */}
              {incomingExhausted && dropsMail && dropped > 0 && (
                <>
                  {' '}
                  <span className="font-medium text-destructive">
                    {dropped} {dropped === 1 ? 'message has' : 'messages have'} been discarded and cannot be
                    recovered.
                  </span>
                </>
              )}
              {formatReset(exhausted[0]?.resetsAt ?? null)}
            </p>
            {upgradeButton}
          </div>
        </div>
      )}

      {approaching.length > 0 && (
        <div className="mb-2 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Approaching your {plan.name} plan limit.</p>
            <p className="text-muted-foreground">
              {approaching
                .map((entry) => `${entry.used} of ${entry.limit} ${METRIC_LABELS[entry.metric] ?? entry.metric}`)
                .join(', ')}
              .
              {dropsMail && ' Incoming email is discarded once the limit is reached.'}
              {formatReset(approaching[0]?.resetsAt ?? null)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
