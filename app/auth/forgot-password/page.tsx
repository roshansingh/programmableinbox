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

/**
 * The confirmation is shown for every outcome, including a failed request.
 *
 * The endpoint is deliberately uniform so it cannot be used to test whether an
 * address has an account; rendering an error here for the failure case would
 * hand back exactly the signal the endpoint withholds.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setIsLoading(true)

    try {
      await requestPasswordReset(email.trim())
    } catch {
      // Intentionally swallowed — see the note above.
    } finally {
      setIsLoading(false)
      setSent(true)
    }
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
          <CardTitle>{sent ? "Check your email" : "Reset your password"}</CardTitle>
          <CardDescription>
            {sent
              ? "If an account exists for that address, we've sent a link to reset your password."
              : "Enter your email address and we'll send you a link to choose a new password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!sent && (
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
