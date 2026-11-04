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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  createPhoneInbox,
  searchAvailablePhoneNumbers,
  type AvailablePhoneNumber,
  type PhoneCountry,
} from "@/lib/api/phones.api"
import { formatPhoneNumber } from "@/lib/phone-format"
import { toast } from "sonner"

interface CreatePhoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId?: string
  onSuccess?: () => void
}

/**
 * Buys a real number. There is deliberately no field to type one: the server
 * only sells numbers Twilio offers, so the user searches an area code and picks
 * from the result. Mirrors `create-email-dialog.tsx` in shape — the user composes
 * an address from constrained parts rather than supplying it.
 */
export function CreatePhoneDialog({ open, onOpenChange, organizationId, onSuccess }: CreatePhoneDialogProps) {
  const [country, setCountry] = useState<PhoneCountry>("US")
  const [areaCode, setAreaCode] = useState("")
  const [results, setResults] = useState<AvailablePhoneNumber[] | null>(null)
  const [selected, setSelected] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [isBuying, setIsBuying] = useState(false)

  const busy = isSearching || isBuying

  // Changing what was searched invalidates the list: buying from a stale one
  // would spend money on a number the user did not see under these criteria.
  const resetResults = () => {
    setResults(null)
    setSelected("")
  }

  const handleSearch = async () => {
    if (!organizationId) {
      toast.error("Organization ID is required")
      return
    }

    setIsSearching(true)
    resetResults()
    try {
      setResults(await searchAvailablePhoneNumbers({ organizationId, country, areaCode }))
    } catch (error: any) {
      toast.error(error?.message || "Failed to search for numbers")
    } finally {
      setIsSearching(false)
    }
  }

  const handleBuy = async () => {
    if (!organizationId || !selected) return

    setIsBuying(true)
    try {
      await createPhoneInbox({ organizationId, phoneNumber: selected, countryCode: country })
      toast.success("Phone number added")
      setAreaCode("")
      resetResults()
      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error(error?.message || "Failed to buy phone number")
      // 409: someone else got it first. Drop it so it cannot be picked again;
      // the rest of the list is still valid, so it stays, and nothing searches
      // again behind the user's back.
      if (error?.status === 409) {
        setResults((current) => current?.filter((n) => n.phoneNumber !== selected) ?? null)
        setSelected("")
      }
    } finally {
      setIsBuying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground">Get a phone number</DialogTitle>
          <DialogDescription>
            Search for an available number by area code, then pick one to receive SMS on.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <div className="grid gap-2">
              <Label htmlFor="country" className="text-foreground">Country</Label>
              <Select
                value={country}
                onValueChange={(value) => {
                  setCountry(value as PhoneCountry)
                  resetResults()
                }}
                disabled={busy}
              >
                <SelectTrigger id="country" className="bg-background text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States (US)</SelectItem>
                  <SelectItem value="CA">Canada (CA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="areaCode" className="text-foreground">Area code</Label>
              <Input
                id="areaCode"
                inputMode="numeric"
                placeholder="415"
                value={areaCode}
                onChange={(e) => {
                  setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))
                  resetResults()
                }}
                className="bg-background text-foreground"
                disabled={busy}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleSearch}
              disabled={busy || areaCode.length !== 3 || !organizationId}
            >
              {isSearching ? "Searching..." : "Search"}
            </Button>
          </div>

          {results !== null && results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No numbers available in that area code. Try another.
            </p>
          )}

          {results !== null && results.length > 0 && (
            <RadioGroup value={selected} onValueChange={setSelected} className="max-h-60 gap-2 overflow-auto">
              {results.map((n) => (
                <div
                  key={n.phoneNumber}
                  className="flex items-center gap-3 rounded-md border border-border p-3"
                >
                  <RadioGroupItem id={`number-${n.phoneNumber}`} value={n.phoneNumber} disabled={busy} />
                  <Label htmlFor={`number-${n.phoneNumber}`} className="flex flex-1 items-baseline justify-between gap-2">
                    <span className="font-mono text-foreground">{formatPhoneNumber(n.phoneNumber)}</span>
                    {(n.locality || n.region) && (
                      <span className="text-xs text-muted-foreground">
                        {[n.locality, n.region].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            <p>This buys a real phone number for your organization. It can receive SMS only.</p>
            <p>Deleting the inbox releases the number permanently — anyone may buy it afterwards.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBuying}>
            Cancel
          </Button>
          <Button
            onClick={handleBuy}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy || !selected || !organizationId}
          >
            {isBuying ? "Buying..." : "Buy number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
