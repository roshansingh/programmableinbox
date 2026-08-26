"use client"

import { useEffect, useState } from "react"
import { MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { logout, resendVerificationEmail } from "@/lib/api/auth.api"

/**
 * Mirrors RESEND_COOLDOWN_SECONDS in lib/auth/verification-token.ts.
 *
 * Duplicated rather than imported because that module is `server-only` — it
 * reads the signing secret. This value is a courtesy countdown, not the
 * enforcement: the server rejects an early retry with 429 whatever the button
 * believes, which is why the 429 path below is handled rather than assumed
 * unreachable.
 */
const RESEND_COOLDOWN_SECONDS = 60

/**
 * The soft gate's screen (issue #102 §8.3).
 *
 * Rendered by `AuthGuard` in place of the dashboard for an authenticated but
 * unverified user. It has to carry three things: which address the mail went
 * to (a typo at signup is the single most common reason for being here), a way
 * to send another, and a way out — signing out is how a user who typed the
 * wrong address starts over, since there is no email-change flow yet.
 */
export function VerifyEmailNotice() {
  const { user } = useAuth()
  const [cooldown, setCooldown] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResend = async () => {
    setIsSending(true)
    setStatus(null)

    try {
      const { sent } = await resendVerificationEmail()
      if (sent) {
        setStatus("Sent. Check your inbox — and your spam folder.")
        setCooldown(RESEND_COOLDOWN_SECONDS)
      } else {
        // `sent: false` means the address is already verified — most likely
        // confirmed in another tab. Reloading picks up the new state.
        setStatus("This address is already verified. Reloading…")
        window.location.reload()
      }
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status
      if (status === 429) {
        // The server is the authority on the cooldown; the client countdown is
        // only an approximation of it (a page reload resets ours, not theirs).
        setStatus("Please wait a moment before requesting another email.")
        setCooldown(RESEND_COOLDOWN_SECONDS)
      } else {
        setStatus(
          (error as { message?: string })?.message ??
            "Could not send the email. Please try again.",
        )
      }
    } finally {
      setIsSending(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await logout()
    } finally {
      window.location.href = "/auth/login"
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <CardTitle>Verify your email address</CardTitle>
          <CardDescription>
            {user?.email ? (
              <>
                We sent a verification link to <strong>{user.email}</strong>. Open it to
                finish setting up your account.
              </>
            ) : (
              <>We sent you a verification link. Open it to finish setting up your account.</>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            If the link has expired, or never arrived, send yourself another one.
          </p>

          {status && (
            <p className="text-sm" role="status">
              {status}
            </p>
          )}

          <Button
            className="w-full"
            onClick={handleResend}
            disabled={isSending || cooldown > 0}
          >
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : isSending
                ? "Sending…"
                : "Resend verification email"}
          </Button>

          <Button variant="ghost" className="w-full" onClick={handleSignOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
