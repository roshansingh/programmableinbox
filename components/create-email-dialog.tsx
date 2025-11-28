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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface CreateEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateEmailDialog({ open, onOpenChange }: CreateEmailDialogProps) {
  const [prefix, setPrefix] = useState("")
  const [domain, setDomain] = useState("inbox.dev")

  const handleCreate = () => {
    // Handle email creation logic here
    console.log(`Creating email: ${prefix}@${domain}`)
    onOpenChange(false)
    setPrefix("")
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
            <Label htmlFor="prefix" className="text-foreground">Email Prefix (optional)</Label>
            <Input
              id="prefix"
              placeholder="Leave empty for random"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className="bg-background text-foreground"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="domain" className="text-foreground">Domain</Label>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger id="domain" className="bg-background text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbox.dev">inbox.dev</SelectItem>
                <SelectItem value="tempmail.io">tempmail.io</SelectItem>
                <SelectItem value="disposable.email">disposable.email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-sm font-medium text-muted-foreground mb-1">Preview:</p>
            <p className="font-mono text-sm text-foreground">
              {prefix || "[random]"}@{domain}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">Create Email</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
