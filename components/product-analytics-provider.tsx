"use client"

import { useEffect, useRef } from "react"
import posthog from "posthog-js"
import { useAuth } from "@/components/auth-provider"

/**
 * Mounts PostHog client-side instrumentation (issue #152).
 *
 * Renders nothing — it exists purely to run `posthog.init()` once the
 * server-visible config says the deployment has product analytics on, and
 * to tear nothing down afterwards (the PostHog SDK is a page-lifetime
 * singleton, same as the module's own `posthog` import).
 *
 * Deliberately inside `<AuthProvider>` rather than a sibling of it, unlike
 * the dead `<Analytics/>` (Vercel) import this replaces: gating on
 * `useAuth().config.productAnalyticsEnabled` requires the auth context to
 * exist, and empty defaults there read "disabled" (see `EMPTY_CONFIG` in
 * `auth-provider.tsx`) — the fail-closed direction, so no instrumentation
 * runs before `/auth/me` resolves.
 *
 * Autocapture, session replay (masked) and exception capture are all
 * PostHog's own opt-in-by-default behaviors once `init()` runs; rageclicks
 * and dead-click detection need no code here at all — they are PostHog
 * features that ride on autocapture.
 */
export function ProductAnalyticsProvider() {
  const { config } = useAuth()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    if (!config.productAnalyticsEnabled) return
    if (!config.posthogApiKey || !config.posthogHost) return

    posthog.init(config.posthogApiKey, {
      api_host: config.posthogHost,
      autocapture: true,
      capture_exceptions: true,
      // Email bodies, an API-key-reveal-once flow and auth-adjacent forms
      // all render in this app, so every input is masked by default.
      // Two elements carry additional, explicit masking on top of this —
      // see the `ph-no-capture` class on the API key dialog
      // (app/api-keys/page.tsx) and the message body view
      // (components/email-html-viewer.tsx) — because maskAllInputs only
      // covers form inputs, not arbitrary rendered content.
      session_recording: {
        maskAllInputs: true,
      },
    })
    initialized.current = true
  }, [config.productAnalyticsEnabled, config.posthogApiKey, config.posthogHost])

  return null
}
