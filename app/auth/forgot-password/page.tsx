"use client"

import { useState } from "react"
import Link from "next/link"
import { MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requestPasswordReset } from "@/lib/api/auth.api"
import type { ApiError } from "@/lib/api-client"

/**
 * True only for a 404 from the request endpoint, which the route returns
 * exclusively when `ENABLE_EMAIL_VERIFICATION` is off — a deployment-level
 * fact identical for every caller, never account-dependent. That is what
 * makes it safe to distinguish here without weakening the enumeration
 * protection below: every other failure (network error, 500, 502, ...) is
 * still swallowed and rendered as the same confirmation as success.
 */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as ApiError).status === 404
  )
}

/**
 * The confirmation is shown for every outcome except a 404, including a
 * failed request.
 *
 * The endpoint is deliberately uniform so it cannot be used to test whether an
 * address has an account; rendering an error here for the failure case would
 * hand back exactly the signal the endpoint withholds. A 404 is the one
 * exception — see isNotFoundError above.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (isLoading) return
    setIsLoading(true)

    try {
      await requestPasswordReset(email.trim())
    } catch (error) {
      if (isNotFoundError(error)) {
        setIsLoading(false)
        setUnavailable(true)
        return
      }
      // Every other failure is intentionally swallowed — see the note above.
    }

    setIsLoading(false)
    setSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {sent && (
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
          )}
          <CardTitle>
            {unavailable ? "Password reset unavailable" : sent ? "Check your email" : "Reset your password"}
          </CardTitle>
          <CardDescription role="status">
            {unavailable
              ? "Password reset isn't available on this deployment."
              : sent
                ? "If an account exists for that address, we've sent a link to reset your password."
                : "Enter your email address and we'll send you a link to choose a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!sent && !unavailable && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          )}
          <div className="text-sm text-center w-full text-muted-foreground">
            <Link href="/auth/login" className="text-primary hover:underline font-medium">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
