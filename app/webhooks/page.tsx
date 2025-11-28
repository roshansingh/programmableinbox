"use client"

import { useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoreVertical, Plus, Trash2, Webhook, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

interface WebhookConfig {
  id: string
  name: string
  url: string
  events: string[]
  createdAt: string
  lastTriggered: string | null
  status: "active" | "inactive" | "failing"
}

const availableEvents = [
  { id: "email.received", label: "Email Received", description: "Triggered when an email is received" },
  { id: "email.forwarded", label: "Email Forwarded", description: "Triggered when an email is forwarded" },
  { id: "email.bounced", label: "Email Bounced", description: "Triggered when an email bounces" },
  { id: "sms.received", label: "SMS Received", description: "Triggered when an SMS is received" },
  { id: "sms.delivered", label: "SMS Delivered", description: "Triggered when an SMS is delivered" },
  { id: "sms.failed", label: "SMS Failed", description: "Triggered when an SMS fails to send" },
]

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([
    {
      id: "1",
      name: "Production Webhook",
      url: "https://api.example.com/webhooks/inbox",
      events: ["email.received", "sms.received"],
      createdAt: "2024-01-15",
      lastTriggered: "2 hours ago",
      status: "active",
    },
    {
      id: "2",
      name: "Email Processing",
      url: "https://hooks.example.com/process-email",
      events: ["email.received", "email.forwarded", "email.bounced"],
      createdAt: "2024-01-10",
      lastTriggered: "1 day ago",
      status: "active",
    },
    {
      id: "3",
      name: "SMS Notifications",
      url: "https://notify.example.com/sms",
      events: ["sms.received", "sms.delivered", "sms.failed"],
      createdAt: "2023-12-20",
      lastTriggered: null,
      status: "failing",
    },
  ])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newWebhookName, setNewWebhookName] = useState("")
  const [newWebhookUrl, setNewWebhookUrl] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    )
  }

  const deleteWebhook = (id: string) => {
    setWebhooks((prev) => prev.filter((webhook) => webhook.id !== id))
  }

  const createWebhook = () => {
    if (!newWebhookName.trim() || !newWebhookUrl.trim() || selectedEvents.length === 0) return

    const newWebhook = {
      id: Date.now().toString(),
      name: newWebhookName,
      url: newWebhookUrl,
      events: selectedEvents,
      createdAt: new Date().toISOString().split("T")[0],
      lastTriggered: null,
      status: "active" as const,
    }

    setWebhooks((prev) => [newWebhook, ...prev])
    closeCreateDialog()
  }

  const closeCreateDialog = () => {
    setIsCreateOpen(false)
    setNewWebhookName("")
    setNewWebhookUrl("")
    setSelectedEvents([])
  }

  const getStatusIcon = (status: WebhookConfig["status"]) => {
    switch (status) {
      case "active":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case "failing":
        return <AlertCircle className="h-4 w-4 text-destructive" />
      default:
        return null
    }
  }

  const getStatusVariant = (status: WebhookConfig["status"]) => {
    switch (status) {
      case "active":
        return "default"
      case "failing":
        return "destructive"
      default:
        return "secondary"
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <DashboardHeader />

        <main className="flex-1 overflow-y-auto px-4 py-6 space-y-6 lg:px-8 lg:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Webhooks</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Configure webhooks to receive real-time event notifications
              </p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Webhook
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Webhook</DialogTitle>
                  <DialogDescription>
                    Configure your webhook endpoint and select which events to receive.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="webhook-name">Webhook Name</Label>
                    <Input
                      id="webhook-name"
                      placeholder="e.g., Production Webhook"
                      value={newWebhookName}
                      onChange={(e) => setNewWebhookName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webhook-url">Webhook URL</Label>
                    <Input
                      id="webhook-url"
                      type="url"
                      placeholder="https://api.example.com/webhooks/inbox"
                      value={newWebhookUrl}
                      onChange={(e) => setNewWebhookUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      This URL will receive POST requests for selected events
                    </p>
                  </div>
                  <div className="space-y-3">
                    <Label>Event Types</Label>
                    <div className="space-y-2">
                      {availableEvents.map((event) => (
                        <div
                          key={event.id}
                          className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-accent transition-colors"
                        >
                          <Checkbox
                            id={event.id}
                            checked={selectedEvents.includes(event.id)}
                            onCheckedChange={() => toggleEvent(event.id)}
                          />
                          <div className="flex-1 space-y-1">
                            <label
                              htmlFor={event.id}
                              className="text-sm font-medium leading-none cursor-pointer"
                            >
                              {event.label}
                            </label>
                            <p className="text-xs text-muted-foreground">
                              {event.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeCreateDialog}>
                    Cancel
                  </Button>
                  <Button
                    onClick={createWebhook}
                    disabled={!newWebhookName.trim() || !newWebhookUrl.trim() || selectedEvents.length === 0}
                  >
                    Create Webhook
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {webhooks.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Webhooks</h3>
                  <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                    Create your first webhook to receive real-time event notifications.
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Webhook
                  </Button>
                </CardContent>
              </Card>
            ) : (
              webhooks.map((webhook) => (
                <Card key={webhook.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-lg">{webhook.name}</CardTitle>
                          <Badge variant={getStatusVariant(webhook.status)} className="gap-1">
                            {getStatusIcon(webhook.status)}
                            {webhook.status}
                          </Badge>
                        </div>
                        <CardDescription>
                          Created on {webhook.createdAt}
                          {webhook.lastTriggered && ` • Last triggered ${webhook.lastTriggered}`}
                        </CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteWebhook(webhook.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Webhook
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Endpoint URL</p>
                      <div className="bg-muted rounded-md px-3 py-2 font-mono text-sm break-all">
                        {webhook.url}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Subscribed Events</p>
                      <div className="flex flex-wrap gap-2">
                        {webhook.events.map((eventId) => {
                          const event = availableEvents.find((e) => e.id === eventId)
                          return (
                            <Badge key={eventId} variant="secondary">
                              {event?.label || eventId}
                            </Badge>
                          )
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
