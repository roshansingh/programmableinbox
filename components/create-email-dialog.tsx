"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createEmailInbox } from "@/lib/api/emails.api"
import { toast } from "sonner"

interface CreateEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId?: string
  onSuccess?: () => void
}

export function CreateEmailDialog({ open, onOpenChange, organizationId, onSuccess }: CreateEmailDialogProps) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleCreate = async () => {
    if (!organizationId) {
      toast.error("Organization ID is required")
      return
    }

    if (!email.trim()) {
      toast.error("Email address is required")
      return
    }

    setIsLoading(true)
    try {
      await createEmailInbox({
        organizationId,
        email: email.trim(),
        name: name.trim() || undefined,
      })
      toast.success("Email inbox created successfully")
      setEmail("")
      setName("")
      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error(error?.message || "Failed to create email inbox")
    } finally {
      setIsLoading(false)
    }
  }

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
            <Label htmlFor="email" className="text-foreground">Email Address *</Label>
            <Input
              id="email"
              type="email"
              placeholder="inbox@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background text-foreground"
              required
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-foreground">Display Name (optional)</Label>
            <Input
              id="name"
              placeholder="e.g., Support Inbox"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background text-foreground"
              disabled={isLoading}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreate} 
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={isLoading || !email.trim() || !organizationId}
          >
            {isLoading ? "Creating..." : "Create Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
