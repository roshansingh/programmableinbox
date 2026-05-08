"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Phone, Copy, Trash2, ExternalLink } from 'lucide-react'
import { CreatePhoneDialog } from "@/components/create-phone-dialog"
import { getPhoneInboxes, deletePhoneInbox, type InboxPhone } from "@/lib/api/phones.api"
import { useAuth } from "@/components/auth-provider"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"

export function PhonesList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const { organizationId } = useAuth()
  const [phones, setPhones] = useState<InboxPhone[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!organizationId) return

    const fetchData = async () => {
      try {
        const inboxes = await getPhoneInboxes({ organizationId })
        setPhones(inboxes)
      } catch (error: any) {
        toast.error(error?.message || "Failed to load phone inboxes")
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [organizationId])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard")
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this phone inbox?")) {
      return
    }

    try {
      await deletePhoneInbox(id)
      setPhones(phones.filter((phone) => phone.id !== id))
      toast.success("Phone inbox deleted successfully")
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete phone inbox")
    }
  }

  const handleRefresh = async () => {
    if (!organizationId) return

    setIsLoading(true)
    try {
      const inboxes = await getPhoneInboxes({ organizationId })
      setPhones(inboxes)
    } catch (error: any) {
      toast.error(error?.message || "Failed to refresh phone inboxes")
    } finally {
      setIsLoading(false)
    }
  }

  const formatPhoneNumber = (phoneNumber: string, countryCode: string) => {
    // Simple formatting - can be enhanced
    if (countryCode === "US" && phoneNumber.length === 10) {
      return `+1 (${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6)}`
    }
    return `+${countryCode} ${phoneNumber}`
  }

  if (isLoading) {
    return (
      <Card className="bg-card">
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className="bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground">Phone Inboxes</CardTitle>
              <CardDescription>Manage your phone inbox numbers</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleRefresh} 
                variant="outline" 
                size="sm"
              >
                Refresh
              </Button>
              <Button 
                onClick={() => setShowCreateDialog(true)} 
                size="sm" 
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {phones.length === 0 ? (
            <div className="text-center py-12">
              <Phone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No phone inboxes</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first phone inbox to start receiving SMS.
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Phone Inbox
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {phones.map((phone) => (
                <Link
                  key={phone.id}
                  href={`/phones/${phone.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4 transition-colors hover:bg-muted/50 cursor-pointer"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="rounded-md bg-primary/10 p-2">
                      <Phone className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-medium text-foreground">
                        {formatPhoneNumber(phone.phoneNumber, phone.countryCode)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                          {phone.countryCode}
                        </Badge>
                        <span className="text-muted-foreground">•</span>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(phone.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.preventDefault()
                        copyToClipboard(formatPhoneNumber(phone.phoneNumber, phone.countryCode))
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.preventDefault()
                        handleDelete(phone.id)
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <CreatePhoneDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog}
        organizationId={organizationId || undefined}
        onSuccess={handleRefresh}
      />
    </>
  )
}
