"use client"

import { useMemo, useState } from "react"
import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Sandbox tokens applied to the untrusted-email iframe.
 *
 * SECURITY: this string must NEVER contain `allow-scripts` or `allow-same-origin`.
 * - no `allow-scripts`  -> inline event handlers, <script>, javascript: URLs are inert
 * - no `allow-same-origin` -> the frame gets an opaque origin, so even if script did
 *   run it could not read localStorage / cookies / the DOM of the host app
 *
 * The two popup tokens are NOT equivalent, and the second is the wider one:
 * - `allow-popups` lets the frame open a new tab at all. Without it the
 *   `target="_blank"` links produced by the injected <base> are blocked outright.
 * - `allow-popups-to-escape-sandbox` means a popup opened from here does NOT
 *   inherit these sandbox flags — the new tab is an ordinary, fully-privileged
 *   browsing context. Without it, following a link would land the user on a
 *   scriptless, opaque-origin page, which breaks essentially every destination.
 *
 * Escaping is accepted because the popup only ever loads the link's own URL as a
 * normal top-level page — the same thing every mail client does when you click a
 * link. It grants the email document itself nothing: this frame stays scriptless
 * and opaque-origin either way, so the email cannot open a window without a user
 * click, nor choose the destination at click time.
 *
 * The residual is `window.opener` on the new tab. Current browsers imply
 * `noopener` for `target="_blank"`, and the opener would in any case be the
 * opaque-origin frame rather than the host app window, leaving only cross-origin
 * navigation of a window the attacker already controls.
 *
 * Widen this string only with that distinction in mind.
 */
export const EMAIL_IFRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox"

const COLLAPSED_HEIGHT = 420
const EXPANDED_HEIGHT = 1400

/**
 * Wrap the raw email body in a minimal document.
 *
 * Nothing here is a security control — the sandbox is. This only makes untrusted
 * markup render sensibly: no referrer on remote assets (tracking pixels), links
 * opening in a new tab instead of navigating the frame in place, and long words /
 * wide tables not blowing out the layout.
 */
export function buildEmailSrcDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    background: #ffffff;
    color: #111827;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    padding: 12px;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  img, video, table { max-width: 100%; }
  img { height: auto; }
  table { border-collapse: collapse; }
  pre { white-space: pre-wrap; overflow-wrap: break-word; }
  a { color: #2563eb; }
</style>
</head>
<body>${html}</body>
</html>`
}

export interface EmailHtmlViewerProps {
  /** Raw, untrusted HTML body as received from the sender. */
  html?: string | null
  /** Plain-text body, rendered instead when there is no HTML part. */
  text?: string | null
  className?: string
  /** Accessible name for the frame. */
  title?: string
}

/**
 * Renders an inbound email body.
 *
 * Email bodies are attacker-controlled (anyone can send mail to a provisioned
 * inbox), so the HTML part is never inserted into this document. It is handed to
 * a sandboxed iframe via `srcdoc`, which executes nothing and cannot reach the
 * host origin. See GitHub issue #36.
 */
export function EmailHtmlViewer({
  html,
  text,
  className,
  title = "Email message content",
}: EmailHtmlViewerProps) {
  const [expanded, setExpanded] = useState(false)

  const srcDoc = useMemo(() => (html ? buildEmailSrcDoc(html) : null), [html])

  if (!srcDoc) {
    return (
      <pre
        className={cn(
          "whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed ph-no-capture",
          className
        )}
      >
        {text ?? ""}
      </pre>
    )
  }

  return (
    // ph-no-capture (issue #152): message content is attacker-controlled and
    // frequently sensitive (receipts, one-time codes, account notices), so it
    // is excluded from PostHog session replay and autocapture outright, on
    // top of the client-wide maskAllInputs (which only covers form inputs,
    // not rendered content like this). The HTML body itself is already
    // isolated in a sandboxed, scriptless iframe for unrelated reasons (see
    // EMAIL_IFRAME_SANDBOX above); that sandbox stops rrweb's page script
    // from recording cross-document iframe content by construction, but the
    // plain-text fallback above renders directly into this document and
    // needs the class explicitly.
    <div className={cn(className, "ph-no-capture")}>
      <div className="rounded-md border border-border overflow-hidden bg-white">
        <iframe
          title={title}
          sandbox={EMAIL_IFRAME_SANDBOX}
          srcDoc={srcDoc}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="w-full block border-0 bg-white"
          style={{ height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT }}
        />
      </div>
      <div className="flex justify-end mt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-xs text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <>
              <Minimize2 className="h-3 w-3 mr-1.5" />
              Collapse message
            </>
          ) : (
            <>
              <Maximize2 className="h-3 w-3 mr-1.5" />
              Expand message
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
