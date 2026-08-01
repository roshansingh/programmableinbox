"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createEmailInbox } from "@/lib/api/emails.api"
import { useAuth } from "@/components/auth-provider"
import { isValidInboxAddress } from "@/lib/email-address"
import {
  isBlockedTerm,
  hasDisallowedNameCharacters,
} from "@/lib/security/blocked-inbox-terms"
import {
  BLOCKED_ADDRESS,
  BLOCKED_NAME,
  NAME_CHARSET,
  NAME_TOO_LONG,
  MAX_NAME_LENGTH,
  NOT_CONFIGURED_HINT,
  LOCAL_PART_REQUIRED,
  LOCAL_PART_INVALID,
} from "@/lib/validation/inbox-policy-messages"
import { toast } from "sonner"

interface CreateEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId?: string
  onSuccess?: () => void
}

/**
 * The address field is a local part plus an operator-configured domain, never
 * free text (issue #98).
 *
 * Mail only reaches this platform for domains verified in Resend and pointed at
 * our webhook, so a free-text field let a user create `foo@gmail.com` — an
 * inbox that is listed, looks live, and can never receive a message. Composing
 * the address from a fixed domain removes that failure mode rather than
 * validating against it.
 *
 * Everything checked here is re-checked server-side. This is the fast, specific
 * half of the story: a request sent directly to the API bypasses this component
 * entirely, and `POST /api/app/emailInbox` rejects it identically.
 */
export function CreateEmailDialog({ open, onOpenChange, organizationId, onSuccess }: CreateEmailDialogProps) {
  const { config } = useAuth()
  const domains = config.emailInboxDomains

  const [localPart, setLocalPart] = useState("")
  const [domain, setDomain] = useState("")
  const [name, setName] = useState("")
  // Whether the user has tried to submit. Client-side errors are computed
  // continuously but only *shown* after an attempt, so the form does not scold
  // someone who is still typing their first character.
  const [submitAttempted, setSubmitAttempted] = useState(false)
  // The server's verdict, which the client cannot recompute (address already
  // claimed, a term only the server knows). Kept separately from the derived
  // client errors precisely because nothing invalidates it except the user
  // changing the input — the effect below is the only thing that clears it.
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Empty means "not configured", which disables the whole form. Never a
  // permissive fallback — that is the bug this dialog exists to fix.
  const isConfigured = domains.length > 0

  // The domain list arrives asynchronously with `/auth/me`, so the default is
  // applied when it lands rather than in useState's initializer. Re-selecting
  // only when the current choice is no longer offered keeps a user's pick
  // across an unrelated refresh.
  useEffect(() => {
    if (domains.length > 0 && !domains.includes(domain)) setDomain(domains[0])
  }, [domains, domain])

  const localPartError = useMemo(() => {
    const value = localPart.trim()
    if (value === "") return LOCAL_PART_REQUIRED

    // Validates the *composed* address, so an `@` typed into the local part is
    // caught here rather than producing `qa@gmail.com@inbox.example.com`.
    if (!isValidInboxAddress(`${value}@${domain}`)) return LOCAL_PART_INVALID
    if (isBlockedTerm(value)) return BLOCKED_ADDRESS
    return null
  }, [localPart, domain])

  // Mirrors validateInboxName server-side, in the same order, so the user sees
  // the same verdict the server would give without paying for the round trip.
  const nameError = useMemo(() => {
    const value = name.trim()
    if (value === "") return null
    if (value.length > MAX_NAME_LENGTH) return NAME_TOO_LONG
    // Charset before terms: a Cyrillic homoglyph normalizes to something the
    // term list does not recognise, so only this check catches it.
    if (hasDisallowedNameCharacters(value)) return NAME_CHARSET
    if (isBlockedTerm(value)) return BLOCKED_NAME
    return null
  }, [name])

  // Any edit invalidates the server's verdict — it was about the values as they
  // were when submitted. Without this the rejection is stuck on screen with no
  // way to clear it short of resubmitting, because the client has no way to
  // recompute whether it still applies.
  useEffect(() => {
    setServerError(null)
  }, [localPart, domain, name])

  /**
   * A single active error, derived rather than stored, so it can never disagree
   * with the current input. Storing it was the bug: a server error set while
   * the derived client error was already `null` left the clearing effect with
   * unchanged dependencies, so it never re-ran.
   */
  const error = (() => {
    if (serverError) {
      // The message identifies which field the server objected to; the strings
      // are shared constants, so this is a lookup rather than a guess.
      const isNameError =
        serverError === BLOCKED_NAME ||
        serverError === NAME_CHARSET ||
        serverError === NAME_TOO_LONG
      return { field: isNameError ? ("name" as const) : ("localPart" as const), message: serverError }
    }
    if (!submitAttempted) return null
    if (localPartError) return { field: "localPart" as const, message: localPartError }
    if (nameError) return { field: "name" as const, message: nameError }
    return null
  })()

  const resetForm = () => {
    setLocalPart("")
    setName("")
    setSubmitAttempted(false)
    setServerError(null)
  }

  const handleCancel = () => {
    // Discard the attempt entirely, so reopening does not resume someone else's
    // half-finished — and rejected — input.
    resetForm()
    onOpenChange(false)
  }

  const handleCreate = async () => {
    if (!organizationId) {
      toast.error("Organization ID is required")
      return
    }

    setSubmitAttempted(true)
    if (localPartError || nameError) return

    setIsLoading(true)
    try {
      await createEmailInbox({
        organizationId,
        email: `${localPart.trim()}@${domain}`,
        name: name.trim() || undefined,
      })
      toast.success("Email inbox created successfully")
      resetForm()
      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      // The server is the authority, so its rejection is shown against the
      // field it concerns rather than only as a toast.
      const message = error?.message || "Failed to create email inbox"
      setServerError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const errorId = "create-email-error"
  const suffixId = "create-email-domain-suffix"
  const labelId = "create-email-label"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground">Create Disposable Email</DialogTitle>
          <DialogDescription>
            Generate a new temporary email address for receiving messages.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label id={labelId} htmlFor="localPart" className="text-foreground">
              Email Address *
            </Label>
            <div className="flex items-stretch">
              <Input
                id="localPart"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder="john"
                // The domain is part of the field's accessible name, so a
                // screen-reader user hears the address being composed rather
                // than an unlabelled fragment.
                aria-labelledby={`${labelId} ${suffixId}`}
                aria-invalid={error?.field === "localPart" ? "true" : undefined}
                aria-describedby={error?.field === "localPart" ? errorId : undefined}
                className="bg-background text-foreground rounded-r-none"
                required
                disabled={isLoading || !isConfigured}
              />
              {domains.length > 1 ? (
                <Select value={domain} onValueChange={setDomain} disabled={isLoading}>
                  <SelectTrigger
                    id={suffixId}
                    aria-label="Domain"
                    className="w-auto rounded-l-none border-l-0 bg-background text-foreground"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((option) => (
                      <SelectItem key={option} value={option}>
                        @{option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span
                  id={suffixId}
                  className="flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground"
                >
                  {isConfigured ? `@${domains[0]}` : ""}
                </span>
              )}
            </div>
            {!isConfigured && (
              <p className="text-sm text-muted-foreground">{NOT_CONFIGURED_HINT}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-foreground">Display Name (optional)</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., John Doe"
              aria-invalid={error?.field === "name" ? "true" : undefined}
              aria-describedby={error?.field === "name" ? errorId : undefined}
              className="bg-background text-foreground"
              disabled={isLoading || !isConfigured}
            />
          </div>
          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={isLoading || !organizationId || !isConfigured}
          >
            {isLoading ? "Creating..." : "Create Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
