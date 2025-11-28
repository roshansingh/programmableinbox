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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface CreatePhoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreatePhoneDialog({ open, onOpenChange }: CreatePhoneDialogProps) {
  const [country, setCountry] = useState("US")
  const [areaCode, setAreaCode] = useState("555")

  const handleCreate = () => {
    // Handle phone number creation logic here
    console.log(`Creating phone number for ${country} with area code ${areaCode}`)
    onOpenChange(false)
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
            <Label htmlFor="country" className="text-foreground">Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger id="country" className="bg-background text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">United States (+1)</SelectItem>
                <SelectItem value="UK">United Kingdom (+44)</SelectItem>
                <SelectItem value="CA">Canada (+1)</SelectItem>
                <SelectItem value="AU">Australia (+61)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="area" className="text-foreground">Area Code Preference</Label>
            <Select value={areaCode} onValueChange={setAreaCode}>
              <SelectTrigger id="area" className="bg-background text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="555">555 (Testing)</SelectItem>
                <SelectItem value="random">Random</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-sm font-medium text-muted-foreground mb-1">Info:</p>
            <p className="text-xs text-muted-foreground">
              A random phone number will be generated based on your preferences.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">Create Number</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
