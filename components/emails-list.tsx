"use client"

import { useState } from "react"
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Mail, Copy, Trash2, ExternalLink } from 'lucide-react'
import { CreateEmailDialog } from "@/components/create-email-dialog"

interface Email {
  id: string
  address: string
  createdAt: string
  messageCount: number
  status: "active" | "expired"
}

export function EmailsList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const router = useRouter()
  const [emails, setEmails] = useState<Email[]>([
    {
      id: "1",
      address: "temp.5f8a2b@inbox.dev",
      createdAt: "2 hours ago",
      messageCount: 12,
      status: "active",
    },
    {
      id: "2",
      address: "anon.9d3e4c@inbox.dev",
      createdAt: "1 day ago",
      messageCount: 5,
      status: "active",
    },
    {
      id: "3",
      address: "priv.1a7b6f@inbox.dev",
      createdAt: "3 days ago",
      messageCount: 23,
      status: "active",
    },
  ])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const deleteEmail = (id: string) => {
    setEmails(emails.filter((email) => email.id !== id))
  }

  return (
    <>
      <Card className="bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground">Disposable Emails</CardTitle>
              <CardDescription>Manage your temporary email addresses</CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              Create
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
                      {email.address}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-muted-foreground">{email.createdAt}</p>
                      <span className="text-muted-foreground">•</span>
                      <p className="text-xs text-muted-foreground">
                        {email.messageCount} messages
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={email.status === "active" ? "default" : "secondary"} className="bg-primary/20 text-primary hover:bg-primary/30">
                    {email.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(email.address)
                    }}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteEmail(email.id)
                    }}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <CreateEmailDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </>
  )
}
