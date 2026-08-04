"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
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
import { confirmPasswordReset } from "@/lib/api/auth.api"
import { validatePassword } from "@/lib/validation/password"

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Captured once. The token is scrubbed from the URL immediately, so reading
  // it from searchParams on a later render would come back empty.
  const tokenRef = useRef<string | null>(null)
  if (tokenRef.current === null) {
    tokenRef.current = searchParams.get("token") ?? ""
  }

  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Scrub the token before anything else can observe it. Left in place it
    // persists in browser history and leaks through the `Referer` header of any
    // third-party resource this page loads — which matters more here than for
    // verification, since this token can change the password.
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  // Deliberately NOT redeemed on mount. Mail scanners and link previews
  // pre-fetch URLs; redeeming on load would burn the token, and `pwh` makes
  // that burn permanent.
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }

    if (password !== confirmation) {
      setError("The passwords do not match")
      return
    }

    setIsLoading(true)
    try {
      await confirmPasswordReset(tokenRef.current!, password)
      router.push("/auth/login")
    } catch (err: unknown) {
      setError(
        (err as { message?: string })?.message ??
          "Could not reset your password. Please try again.",
      )
      setIsLoading(false)
    }
  }

  if (!tokenRef.current) {
    return (
      <Shell
        title="This link is not valid"
        description="It may be incomplete or have already been used. Request a new one."
      >
        <Button className="w-full" asChild>
          <Link href="/auth/forgot-password">Request a new link</Link>
        </Button>
      </Shell>
    )
  }

  return (
    <Shell title="Choose a new password" description="Enter a new password for your account.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmation">Confirm new password</Label>
          <Input
            id="confirmation"
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
          {isLoading ? "Resetting..." : "Reset password"}
        </Button>
      </form>
    </Shell>
  )
}

function Shell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary to keep this page statically
  // prerenderable, the same shape /auth/verify uses.
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  )
}
