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
import { createPhoneInbox } from "@/lib/api/phones.api"
import { toast } from "sonner"

interface CreatePhoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId?: string
  onSuccess?: () => void
}

const COUNTRY_CODES: Record<string, string> = {
  US: "US",
  UK: "GB",
  CA: "CA",
  AU: "AU",
}

export function CreatePhoneDialog({ open, onOpenChange, organizationId, onSuccess }: CreatePhoneDialogProps) {
  const [countryCode, setCountryCode] = useState("US")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleCreate = async () => {
    if (!organizationId) {
      toast.error("Organization ID is required")
      return
    }

    if (!phoneNumber.trim()) {
      toast.error("Phone number is required")
      return
    }

    // Remove any non-digit characters
    const cleanPhoneNumber = phoneNumber.replace(/\D/g, '')

    if (cleanPhoneNumber.length === 0) {
      toast.error("Please enter a valid phone number")
      return
    }

    setIsLoading(true)
    try {
      await createPhoneInbox({
        organizationId,
        phoneNumber: cleanPhoneNumber,
        countryCode: COUNTRY_CODES[countryCode] || countryCode,
      })
      toast.success("Phone inbox created successfully")
      setPhoneNumber("")
      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error(error?.message || "Failed to create phone inbox")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground">Create Phone Number</DialogTitle>
          <DialogDescription>
            Generate a new temporary phone number for receiving SMS.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="countryCode" className="text-foreground">Country Code *</Label>
            <Select value={countryCode} onValueChange={setCountryCode} disabled={isLoading}>
              <SelectTrigger id="countryCode" className="bg-background text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">United States (US)</SelectItem>
                <SelectItem value="UK">United Kingdom (GB)</SelectItem>
                <SelectItem value="CA">Canada (CA)</SelectItem>
                <SelectItem value="AU">Australia (AU)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phoneNumber" className="text-foreground">Phone Number *</Label>
            <Input
              id="phoneNumber"
              type="tel"
              placeholder="1234567890 (digits only)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="bg-background text-foreground"
              required
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Enter phone number digits only (no formatting)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreate} 
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={isLoading || !phoneNumber.trim() || !organizationId}
          >
            {isLoading ? "Creating..." : "Create Number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
