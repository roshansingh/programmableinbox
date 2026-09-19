"use client"

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createAutomation, type AutomationRecord } from '@/lib/api/automations.api'
import { MAX_AUTOMATION_NAME_LENGTH } from '@/lib/automations/name'

interface CreateAutomationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  defaultName: string
  onCreated: (automation: AutomationRecord) => void
}

export function CreateAutomationDialog({
  open,
  onOpenChange,
  organizationId,
  defaultName,
  onCreated,
}: CreateAutomationDialogProps) {
  const [name, setName] = useState(defaultName)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // A reopened dialog starts from the current default, not from whatever was
  // typed before it was cancelled.
  useEffect(() => {
    if (open) setName(defaultName)
  }, [open, defaultName])

  const trimmedName = name.trim()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmedName || isSubmitting) return

    setIsSubmitting(true)
    try {
      const created = await createAutomation({ organizationId, name: trimmedName })
      toast.success('Automation created')
      onOpenChange(false)
      onCreated(created)
    } catch (error: any) {
      // Stay open: the typed name is kept and the user can retry.
      toast.error(error?.message || 'Failed to create automation')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="bg-card text-card-foreground sm:max-w-[425px]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Automation</DialogTitle>
            <DialogDescription>Give your automation a name. You can rename it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="automation-name" className="text-foreground">
              Name
            </Label>
            <Input
              id="automation-name"
              value={name}
              maxLength={MAX_AUTOMATION_NAME_LENGTH}
              autoFocus
              autoComplete="off"
              onFocus={(event) => event.target.select()}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmedName || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
