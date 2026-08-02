"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { MailCheck, MailWarning } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { confirmEmailVerification } from "@/lib/api/auth.api"

type Status = "verifying" | "success" | "expired" | "invalid"

const EXPIRED_MESSAGE = "This verification link has expired"

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, refreshUser } = useAuth()

  const [status, setStatus] = useState<Status>("verifying")
  // React 19 in dev mounts effects twice; without this the token is redeemed
  // twice. Redemption is idempotent server-side, so this is tidiness rather
  // than correctness — but a duplicated request that races the URL scrub can
  // report `invalid` for a link that worked.
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    const token = searchParams.get("token")
    if (!token) {
      setStatus("invalid")
      return
    }

    // Scrub the token from the URL before anything else can observe it. Left
    // in place it persists in browser history and leaks through the `Referer`
    // header of any third-party resource this page loads.
    window.history.replaceState(null, "", window.location.pathname)

    confirmEmailVerification(token)
      .then(async () => {
        // Always refresh, rather than only when a session looks present.
        // `isAuthenticated` here is the mount-time value — /auth/me has not
        // resolved yet, so it is false even for a signed-in user, and
        // branching on it would skip the refresh every time. The stale `user`
        // that left behind still carries `emailVerified: false`, which sends
        // the newly-verified user straight back into the gate on the next
        // page. Refreshing also settles whether a session exists at all, which
        // is what the success screen's call to action depends on.
        await refreshUser()
        setStatus("success")
      })
      .catch((error: unknown) => {
        const message = (error as { message?: string })?.message ?? ""
        setStatus(message === EXPIRED_MESSAGE ? "expired" : "invalid")
      })
    // Empty deps, and additionally guarded by `attempted`: re-running would
    // re-POST a token that has already been scrubbed from the URL.
  }, [])

  if (status === "verifying") {
    return (
      <Shell title="Verifying your email…" description="This will only take a moment.">
        <div className="flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      </Shell>
    )
  }

  if (status === "success") {
    return (
      <Shell
        icon="check"
        title="Email verified"
        description={
          isAuthenticated
            ? "Your address is confirmed. Taking you to your inbox…"
            : "Your address is confirmed. Sign in on this device to continue."
        }
      >
        {isAuthenticated ? (
          <Button className="w-full" onClick={() => router.push("/")}>
            Go to the dashboard
          </Button>
        ) : (
          <Button className="w-full" asChild>
            <Link href="/auth/login">Go to sign in</Link>
          </Button>
        )}
      </Shell>
    )
  }

  if (status === "expired") {
    return (
      <Shell
        icon="warning"
        title="This link has expired"
        description="Verification links are valid for 24 hours. Sign in and send yourself a new one."
      >
        <Button className="w-full" asChild>
          <Link href="/auth/login">Go to sign in</Link>
        </Button>
      </Shell>
    )
  }

  return (
    <Shell
      icon="warning"
      title="This link is not valid"
      description="It may have already been used, or the address it was issued for has since changed. Sign in to request a new one."
    >
      <Button className="w-full" asChild>
        <Link href="/auth/login">Go to sign in</Link>
      </Button>
    </Shell>
  )
}

function Shell({
  icon,
  title,
  description,
  children,
}: {
  icon?: "check" | "warning"
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {icon && (
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              {icon === "check" ? (
                <MailCheck className="h-6 w-6 text-primary" aria-hidden="true" />
              ) : (
                <MailWarning className="h-6 w-6 text-primary" aria-hidden="true" />
              )}
            </div>
          )}
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary to keep this page statically
  // prerenderable, the same shape /auth/login uses for its `redirect` param.
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  )
}
