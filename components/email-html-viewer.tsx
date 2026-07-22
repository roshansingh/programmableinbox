"use client"

import { useMemo, useState } from "react"
import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Sandbox tokens applied to the untrusted-email iframe.
 *
 * SECURITY: this string must NEVER contain `allow-scripts` or `allow-same-origin`.
 * - no `allow-scripts`  -> inline event handlers, <script>, javascript: URLs are inert
 * - no `allow-same-origin` -> the frame gets an opaque origin, so even if script did
 *   run it could not read localStorage / cookies / the DOM of the host app
 *
 * `allow-popups` + `allow-popups-to-escape-sandbox` only enable user-initiated
 * `target="_blank"` link clicks (see the injected <base> below). With scripting
 * disabled there is no way for the email to open a window without a click.
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
      <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
        {text ?? ""}
      </pre>
    )
  }

  return (
    <div className={className}>
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
