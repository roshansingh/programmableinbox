"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Trash2, Star, Reply, Forward, MoreVertical, Mail, ChevronDown, ChevronUp, RefreshCw, Copy, ExternalLink, Search, X } from 'lucide-react'
import { useRouter, useParams } from 'next/navigation'
import { formatDistanceToNow } from "date-fns"
import { getEmailInbox, getEmailMessages, deleteEmailMessage, starEmailMessage, type InboxEmail, type EmailMessage } from "@/lib/api/emails.api"
import { ComposeEmailDialog } from "@/components/compose-email-dialog"
import { EmailHtmlViewer } from "@/components/email-html-viewer"
import { toast } from 'sonner'

export default function InboxPage() {
  const router = useRouter()
  const params = useParams()
  const inboxId = params.id as string

  const [inbox, setInbox] = useState<InboxEmail | null>(null)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [listCursor, setListCursor] = useState<string | null>(null)
  const [listHasMore, setListHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
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

  const toggleStar = async (message: EmailMessage) => {
    const newValue = !message.isStarred
    setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, isStarred: newValue } : m))
    if (selectedMessage?.id === message.id) {
      setSelectedMessage((prev) => prev ? { ...prev, isStarred: newValue } : prev)
    }
    try {
      await starEmailMessage(inboxId, message.id, newValue)
    } catch {
      // Revert on failure
      setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, isStarred: message.isStarred } : m))
      if (selectedMessage?.id === message.id) {
        setSelectedMessage((prev) => prev ? { ...prev, isStarred: message.isStarred } : prev)
      }
      toast.error('Failed to update star')
    }
  }

  const handleDelete = async (messageId: string) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return
    try {
      await deleteEmailMessage(inboxId, messageId)
      toast.success('Message deleted')
      setSelectedMessage(null)
      setShowMessageDetail(false)
      await fetchData()
    } catch {
      toast.error('Failed to delete message')
    }
  }

  const fetchData = async () => {
    // Only the very first load blanks the page; a search-driven refetch
    // reuses the existing list in place so typing doesn't flash the whole
    // view to a spinner on every debounce tick.
    const isInitialLoad = inbox === null
    // Inbox metadata (email, name, isOwner) doesn't change while searching —
    // refetching it on every debounce tick is a wasted request.
    const skipInboxRefetch = !isInitialLoad && debouncedQuery !== ''
    if (isInitialLoad) setIsLoading(true)
    else setIsSearching(true)
    try {
      const [inboxData, messagesData] = await Promise.all([
        skipInboxRefetch ? Promise.resolve(inbox) : getEmailInbox(inboxId),
        getEmailMessages(
          inboxId,
          debouncedQuery ? { q: debouncedQuery, grouped: false } : { grouped: true }
        ),
      ])
      setInbox(inboxData)
      setMessages(messagesData.messages)
      setListCursor(messagesData.nextCursor)
      setListHasMore(messagesData.hasMore)
    } catch (error) {
      console.error('Failed to fetch inbox data:', error)
    } finally {
      if (isInitialLoad) setIsLoading(false)
      setIsSearching(false)
    }
  }

  const loadMoreThreads = async () => {
    if (!listCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const data = await getEmailMessages(
        inboxId,
        debouncedQuery
          ? { q: debouncedQuery, grouped: false, cursor: listCursor }
          : { grouped: true, cursor: listCursor }
      )
      setMessages((prev) => [...prev, ...data.messages])
      setListCursor(data.nextCursor)
      setListHasMore(data.hasMore)
    } catch {
      toast.error('Failed to load more messages')
    } finally {
      setIsLoadingMore(false)
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300)
    return () => clearTimeout(handle)
  }, [searchQuery])

  useEffect(() => {
    fetchData()
  }, [inboxId, debouncedQuery])

  // A search-driven refetch replaces the list; a stale selection would leave
  // the detail pane showing a message no longer in the new results, and on
  // mobile keep the list hidden behind it.
  useEffect(() => {
    setSelectedMessage(null)
    setShowMessageDetail(false)
  }, [debouncedQuery])

  // Fetch all messages in the thread when a message is selected
  useEffect(() => {
    if (!selectedMessage) {
      setThreadMessages([])
      return
    }

    let cancelled = false

    const fetchThread = async () => {
      try {
        const collected: EmailMessage[] = []
        let cursor: string | undefined = undefined
        // Threads are bounded; page through until exhausted. Bail as soon as the
        // effect is torn down so a stale selection stops fetching further pages.
        do {
          const data = await getEmailMessages(inboxId, {
            threadId: selectedMessage.threadId,
            cursor,
          })
          if (cancelled) return
          collected.push(...data.messages)
          cursor = data.nextCursor ?? undefined
        } while (cursor)
        if (!cancelled) {
          setThreadMessages(
            collected.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          )
        }
      } catch {
        if (!cancelled) setThreadMessages([])
      }
    }

    fetchThread()

    return () => {
      cancelled = true
    }
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

  const hasEnrichment = selectedMessage && (
    (selectedMessage.categories && selectedMessage.categories.length > 0) ||
    selectedMessage.extractedOtp ||
    selectedMessage.metadata !== null
  )

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
              <div className="flex items-center gap-1.5 overflow-hidden">
                <Mail className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-xs lg:text-sm font-medium text-foreground truncate">
                  {inbox?.email || inboxId}
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
                  · {messages.length} {messages.length === 1 ? 'message' : 'messages'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchData}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`h-4 w-4 ${isSearching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="flex h-[calc(100vh-9rem)] overflow-hidden">
            {/* Message list */}
            <div className={`w-full lg:w-96 border-r border-border bg-card ${showMessageDetail ? 'hidden lg:block' : 'block'}`}>
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search messages"
                    aria-label="Search messages"
                    className="h-9 pl-8 pr-7 text-sm"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <ScrollArea className="h-[calc(100%-3.75rem)]">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Mail className="h-12 w-12 mb-4 opacity-50" />
                    {debouncedQuery ? (
                      <>
                        <p className="text-sm">No messages match &ldquo;{debouncedQuery}&rdquo;</p>
                        <p className="text-xs mt-1">Try a different search term</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm">No messages yet</p>
                        <p className="text-xs mt-1">Emails sent to this inbox will appear here</p>
                      </>
                    )}
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
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleStar(message) }}
                              className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
                            >
                              <Star
                                className="h-3.5 w-3.5"
                                fill={message.isStarred ? '#eab308' : 'none'}
                                stroke={message.isStarred ? '#eab308' : '#6b7280'}
                              />
                            </button>
                            <p className="text-sm font-medium truncate text-foreground">
                              {message.from}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
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
                        {message.threadCount !== undefined && message.threadCount > 1 && (
                          <Badge variant="outline" className="text-xs mt-2">
                            {message.threadCount} messages
                          </Badge>
                        )}
                      </div>
                    ))}
                    {listHasMore && (
                      <div className="p-3">
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={loadMoreThreads}
                          disabled={isLoadingMore}
                        >
                          {isLoadingMore ? 'Loading…' : 'Load more'}
                        </Button>
                      </div>
                    )}
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
                          <p className="text-xs text-muted-foreground">
                            {threadMessages.length} messages in this conversation
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {inbox?.isOwner && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={selectedMessage.isStarred ? 'Unstar message' : 'Star message'}
                          className="h-8 w-8 hidden sm:flex"
                          onClick={() => toggleStar(selectedMessage)}
                        >
                          <Star
                            className="h-4 w-4"
                            fill={selectedMessage.isStarred ? '#eab308' : 'none'}
                            stroke={selectedMessage.isStarred ? '#eab308' : 'currentColor'}
                          />
                        </Button>
                        )}
                        {/*
                          Owner-only, like the star above and Reply/Forward
                          below. Reads are organization-wide so a colleague can
                          open this inbox, but starring, deleting and sending
                          all resolve through toOwnerScope and 404 for them.
                        */}
                        {inbox?.isOwner && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete message"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleDelete(selectedMessage.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      {inbox?.isOwner && (
                        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto" onClick={() => openCompose("reply", threadMessages[threadMessages.length - 1] || selectedMessage)}>
                          <Reply className="h-3 w-3 mr-2" />
                          Reply
                        </Button>
                      )}
                      {inbox?.isOwner && (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => openCompose("forward", threadMessages[threadMessages.length - 1] || selectedMessage)}>
                        <Forward className="h-3 w-3 mr-2" />
                        Forward
                      </Button>
                      )}
                    </div>
                  </div>

                  {/* Thread messages + enrichment panel */}
                  <div className="flex flex-1 overflow-hidden">
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
                                  {/* Email bodies are attacker-controlled — rendered in a sandboxed iframe, never in this document. See issue #36. */}
                                  <EmailHtmlViewer
                                    html={msg.html}
                                    text={msg.text}
                                    title={`Message from ${msg.from}`}
                                  />
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

                    {/* Enrichment details panel */}
                    {hasEnrichment && (
                      <div className="w-72 border-l border-border bg-card hidden lg:flex flex-col flex-shrink-0 overflow-hidden">
                        <div className="px-4 py-3 border-b border-border flex-shrink-0">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Enrichment</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-5">
                          {selectedMessage.categories && selectedMessage.categories.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Categories</p>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedMessage.categories.map((cat) => (
                                  <Badge key={cat} variant="secondary" className="text-xs font-normal">{cat}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {selectedMessage.extractedOtp && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">OTP</p>
                              <div className="flex items-center gap-2">
                                <code className="font-mono text-lg bg-muted px-3 py-1.5 rounded tracking-widest text-foreground flex-1 text-center">
                                  {selectedMessage.extractedOtp}
                                </code>
                                <button
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(selectedMessage.extractedOtp!)
                                      toast.success('OTP copied')
                                    } catch {
                                      toast.error('Failed to copy OTP')
                                    }
                                  }}
                                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                >
                                  <Copy className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          )}
                          {selectedMessage.metadata !== null && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Metadata</p>
                              <pre className="text-xs font-mono bg-muted rounded p-3 leading-relaxed text-foreground whitespace-pre-wrap break-all">
                                {JSON.stringify(selectedMessage.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
