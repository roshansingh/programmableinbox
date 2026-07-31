"use client"

import { useState, useEffect } from "react"
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Mail, Copy, Trash2, ExternalLink } from 'lucide-react'
import { CreateEmailDialog } from "@/components/create-email-dialog"
import { getEmailInboxes, deleteEmailInbox, type InboxEmail } from "@/lib/api/emails.api"
import { useAuth } from "@/components/auth-provider"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"

export function EmailsList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const router = useRouter()
  const { organizationId } = useAuth()
  const [emails, setEmails] = useState<InboxEmail[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!organizationId) return

    const fetchData = async () => {
      try {
        const inboxes = await getEmailInboxes({ organizationId })
        setEmails(inboxes)
      } catch (error: any) {
        toast.error(error?.message || "Failed to load email inboxes")
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
    if (!confirm("Are you sure you want to delete this email inbox?")) {
      return
    }

    try {
      await deleteEmailInbox(id)
      setEmails(emails.filter((email) => email.id !== id))
      toast.success("Email inbox deleted successfully")
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete email inbox")
    }
  }

  const handleRefresh = async () => {
    if (!organizationId) return

    setIsLoading(true)
    try {
      const inboxes = await getEmailInboxes({ organizationId })
      setEmails(inboxes)
    } catch (error: any) {
      toast.error(error?.message || "Failed to refresh email inboxes")
    } finally {
      setIsLoading(false)
    }
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
              <CardTitle className="text-foreground">Email Inboxes</CardTitle>
              <CardDescription>Manage your email inbox addresses</CardDescription>
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
          {emails.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No email inboxes</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first email inbox to start receiving emails.
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Email Inbox
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {emails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => router.push(`/emails/${email.id}`)}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4 transition-colors hover:bg-muted/50 cursor-pointer"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="rounded-md bg-primary/10 p-2">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-medium text-foreground truncate">
                        {email.email}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {email.name && (
                          <>
                            <p className="text-xs text-muted-foreground">{email.name}</p>
                            <span className="text-muted-foreground">•</span>
                          </>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(email.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Copy address ${email.email}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        copyToClipboard(email.email)
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Open inbox ${email.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    {/*
                      Owner-only. Reads widened to the whole organization but
                      mutation authority did not, so a colleague's inbox appears
                      in this list while DELETE on it returns 404. Rendering the
                      control anyway would offer an action that always fails.
                    */}
                    {email.isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete inbox ${email.email}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(email.id)
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <CreateEmailDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog}
        organizationId={organizationId || undefined}
        onSuccess={handleRefresh}
      />
    </>
  )
}
