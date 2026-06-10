"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowLeft, Trash2, Archive, Star, Reply, Forward, MoreVertical, Mail, ChevronDown, ChevronUp, RefreshCw, Copy, ExternalLink } from 'lucide-react'
import { useRouter, useParams } from 'next/navigation'
import { formatDistanceToNow } from "date-fns"
import { getEmailInbox, getEmailMessages, type InboxEmail, type EmailMessage } from "@/lib/api/emails.api"
import { ComposeEmailDialog } from "@/components/compose-email-dialog"
import { toast } from 'sonner'

export default function InboxPage() {
  const router = useRouter()
  const params = useParams()
  const inboxId = params.id as string

  const [inbox, setInbox] = useState<InboxEmail | null>(null)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null)
  const [expandedThreadMessages, setExpandedThreadMessages] = useState<Set<string>>(new Set())
  const [showMessageDetail, setShowMessageDetail] = useState(false)
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([])
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeMode, setComposeMode] = useState<"reply" | "forward">("reply")
  const [composeTarget, setComposeTarget] = useState<EmailMessage | null>(null)

  const openCompose = (mode: "reply" | "forward", message: EmailMessage) => {
    setComposeMode(mode)
    setComposeTarget(message)
    setComposeOpen(true)
  }

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [inboxData, messagesData] = await Promise.all([
        getEmailInbox(inboxId),
        getEmailMessages(inboxId, { grouped: true }),
      ])
      setInbox(inboxData)
      setMessages(messagesData.messages)
    } catch (error) {
      console.error('Failed to fetch inbox data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [inboxId])

  // Fetch all messages in the thread when a message is selected
  useEffect(() => {
    if (!selectedMessage) {
      setThreadMessages([])
      return
    }

    const fetchThread = async () => {
      try {
        const data = await getEmailMessages(inboxId, { threadId: selectedMessage.threadId })
        // Sort chronologically (oldest first)
        setThreadMessages(
          data.messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        )
      } catch {
        setThreadMessages([])
      }
    }

    fetchThread()
  }, [selectedMessage?.id])

  const toggleThreadMessage = (messageId: string) => {
    const newExpanded = new Set(expandedThreadMessages)
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId)
    } else {
      newExpanded.add(messageId)
    }
    setExpandedThreadMessages(newExpanded)
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <DashboardHeader />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <DashboardHeader />

        <main className="flex-1 overflow-hidden">
          <div className="border-b border-border bg-card px-4 py-3 lg:px-8">
            <div className="flex items-center gap-2 lg:gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (showMessageDetail) {
                    setShowMessageDetail(false)
                  } else {
                    router.push("/emails")
                  }
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4 mr-0 lg:mr-2" />
                <span className="hidden lg:inline">Back</span>
              </Button>
              <div className="flex items-center gap-2 overflow-hidden">
                <Mail className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-xs lg:text-sm font-medium text-foreground truncate">
                  {inbox?.email || inboxId}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchData}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex h-[calc(100vh-9rem)] overflow-hidden">
            {/* Message list */}
            <div className={`w-full lg:w-96 border-r border-border bg-card ${showMessageDetail ? 'hidden lg:block' : 'block'}`}>
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  <h2 className="font-semibold text-foreground">Inbox</h2>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{messages.length} messages</p>
              </div>

              <ScrollArea className="h-[calc(100%-4rem)]">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Mail className="h-12 w-12 mb-4 opacity-50" />
                    <p className="text-sm">No messages yet</p>
                    <p className="text-xs mt-1">Emails sent to this inbox will appear here</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        onClick={() => {
                          setSelectedMessage(message)
                          setShowMessageDetail(true)
                        }}
                        className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                          selectedMessage?.id === message.id ? "bg-muted/50 border-l-2 border-primary" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm font-medium truncate text-foreground">
                            {message.from}
                          </p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm truncate mb-1 text-muted-foreground">
                          {message.subject}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {message.text?.slice(0, 100) || '(No preview)'}
                        </p>
                        {message.categories && message.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {message.categories.slice(0, 3).map((cat) => (
                              <Badge key={cat} variant="secondary" className="text-xs px-1.5 py-0 font-normal">
                                {cat}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {(message as any).threadCount > 1 && (
                          <Badge variant="outline" className="text-xs mt-2">
                            {(message as any).threadCount} messages
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Message detail pane */}
            <div className={`flex-1 flex-col bg-background overflow-hidden ${showMessageDetail ? 'flex' : 'hidden lg:flex'}`}>
              {selectedMessage ? (
                <>
                  {/* Thread header */}
                  <div className="border-b border-border bg-card px-4 lg:px-6 py-4 flex-shrink-0">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h1 className="text-lg lg:text-xl font-semibold text-foreground mb-2 text-balance">
                          {selectedMessage.subject}
                        </h1>
                        {threadMessages.length > 1 && (
                          <p className="text-xs text-muted-foreground mb-2">
                            {threadMessages.length} messages in this conversation
                          </p>
                        )}
                        {selectedMessage.categories && selectedMessage.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {selectedMessage.categories.map((cat) => (
                              <Badge key={cat} variant="secondary" className="text-xs font-normal">
                                {cat}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:flex">
                          <Star className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:flex">
                          <Archive className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto" onClick={() => openCompose("reply", threadMessages[threadMessages.length - 1] || selectedMessage)}>
                        <Reply className="h-3 w-3 mr-2" />
                        Reply
                      </Button>
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => openCompose("forward", threadMessages[threadMessages.length - 1] || selectedMessage)}>
                        <Forward className="h-3 w-3 mr-2" />
                        Forward
                      </Button>
                    </div>
                  </div>

                  {/* Full thread view - all messages chronologically */}
                  <ScrollArea className="flex-1 overflow-auto">
                    <div className="px-4 lg:px-6 py-4 lg:py-6 space-y-4">
                      {threadMessages.map((msg, index) => {
                        const isLatest = index === threadMessages.length - 1
                        // Latest message is always expanded, others are collapsible
                        const isExpanded = isLatest || expandedThreadMessages.has(msg.id)

                        return (
                          <div key={msg.id} className="border border-border rounded-lg bg-card">
                            <div
                              className={`border-b border-border px-4 py-3 ${!isLatest ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
                              onClick={() => { if (!isLatest) toggleThreadMessage(msg.id) }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.from === inbox?.email ? 'bg-green-500/10' : 'bg-primary/10'}`}>
                                    <span className={`text-xs font-semibold ${msg.from === inbox?.email ? 'text-green-600' : 'text-primary'}`}>
                                      {msg.from === inbox?.email ? 'You' : msg.from.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                      {msg.from === inbox?.email ? 'You' : msg.from}
                                    </p>
                                    {!isExpanded && (
                                      <p className="text-xs text-muted-foreground truncate">
                                        {msg.text?.slice(0, 80) || msg.subject}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
                                    {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                                  </span>
                                  {!isLatest && (
                                    expandedThreadMessages.has(msg.id) ? (
                                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    )
                                  )}
                                </div>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="px-4 py-4">
                                <p className="text-xs text-muted-foreground mb-3">
                                  to {msg.to.join(', ')}
                                  {msg.cc?.length > 0 && ` | cc: ${msg.cc.join(', ')}`}
                                </p>
                                {msg.html ? (
                                  <div
                                    className="prose prose-sm max-w-none text-foreground"
                                    dangerouslySetInnerHTML={{ __html: msg.html }}
                                  />
                                ) : (
                                  <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                                    {msg.text}
                                  </pre>
                                )}
                                {msg.metadata && (
                                  <div className="mt-4 pt-3 border-t border-border space-y-3">
                                    {msg.extractedOtp && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">OTP</span>
                                        <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{msg.extractedOtp}</code>
                                        <button
                                          onClick={async () => {
                                            try {
                                              await navigator.clipboard.writeText(msg.extractedOtp!)
                                              toast.success('OTP copied')
                                            } catch {
                                              toast.error('Failed to copy OTP')
                                            }
                                          }}
                                          className="text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    )}
                                    {msg.metadata.links.length > 0 && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Links</p>
                                        <div className="space-y-1">
                                          {msg.metadata.links.map((link, i) => (
                                            <div key={i} className="flex items-center gap-1.5">
                                              <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-primary hover:underline truncate max-w-sm"
                                              >
                                                {link.label || link.url}
                                              </a>
                                              {link.isCta && (
                                                <Badge variant="outline" className="text-xs px-1 py-0 shrink-0">CTA</Badge>
                                              )}
                                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {msg.metadata.timestamps.length > 0 && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Timestamps</p>
                                        <div className="space-y-0.5">
                                          {msg.metadata.timestamps.map((ts, i) => (
                                            <p key={i} className="text-xs text-muted-foreground">{ts}</p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {!isLatest && (
                                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-4 pt-3 border-t border-border">
                                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openCompose("reply", msg)}>
                                      <Reply className="h-3 w-3 mr-2" />
                                      Reply
                                    </Button>
                                    <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openCompose("forward", msg)}>
                                      <Forward className="h-3 w-3 mr-2" />
                                      Forward
                                    </Button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center px-4">
                    <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Select a message to read</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {composeTarget && (
        <ComposeEmailDialog
          open={composeOpen}
          onOpenChange={setComposeOpen}
          inboxId={inboxId}
          inboxEmail={inbox?.email || ""}
          mode={composeMode}
          originalMessage={composeTarget}
          onSent={fetchData}
        />
      )}
    </div>
  )
}
