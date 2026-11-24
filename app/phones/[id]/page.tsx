"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from 'next/navigation'
import { formatDistanceToNow } from "date-fns"
import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Phone, RefreshCw } from 'lucide-react'
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  getPhoneInbox,
  getPhoneThreads,
  getPhoneThreadMessages,
  setPhoneThreadRead,
  type InboxPhone,
  type PhoneMessage,
  type PhoneThread,
} from "@/lib/api/phones.api"

/** Senders are E.164, short codes (`32665`) or alphanumeric; two characters is enough for an avatar. */
function initials(from: string): string {
  return from.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "#"
}

function ago(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true })
}

/** An MMS can arrive with media and no text; media is not stored, so say so rather than render nothing. */
function attachmentNote(count: number): string {
  return `${count} attachment${count === 1 ? "" : "s"} not stored`
}

/** What a thread row previews: the text, else the media note, else a marker, never a blank or "0 attachments". */
function preview(body: string, mediaCount: number): string {
  if (body) return body
  return mediaCount > 0 ? attachmentNote(mediaCount) : "(empty message)"
}

export default function PhoneMessagesPage() {
  const params = useParams()
  const router = useRouter()
  const inboxId = params.id as string

  const [inbox, setInbox] = useState<InboxPhone | null>(null)
  const [threads, setThreads] = useState<PhoneThread[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  // Kept on its own: a refresh replaces the thread list, and the open thread may
  // not be on its first page, which would blank the header.
  const [selectedFrom, setSelectedFrom] = useState("")
  // Newest first, exactly as the API returns it; reversed for display.
  const [messages, setMessages] = useState<PhoneMessage[]>([])
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState(false)
  const [showThreadList, setShowThreadList] = useState(true)

  // A slow response for a thread the user has already left must not overwrite
  // the one now on screen.
  const selectedRef = useRef<string | null>(null)
  // Bumped every time the list is replaced. A "Load more" started against an
  // earlier list carries a cursor that no longer continues anything.
  const listGeneration = useRef(0)

  const loadThreads = useCallback(async () => {
    listGeneration.current += 1
    try {
      const [inboxRow, page] = await Promise.all([getPhoneInbox(inboxId), getPhoneThreads(inboxId)])
      setInbox(inboxRow)
      setThreads(page.threads)
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setStatus("ready")
    } catch {
      setStatus("error")
    }
  }, [inboxId])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const loadMoreThreads = async () => {
    if (!nextCursor || isLoadingMore) return
    const generation = listGeneration.current
    setIsLoadingMore(true)
    try {
      const page = await getPhoneThreads(inboxId, { cursor: nextCursor })
      if (generation !== listGeneration.current) return
      // A thread that received a text while the page was loading now sits on the
      // first page as well; keep the copy already shown.
      setThreads((prev) => {
        const have = new Set(prev.map((t) => t.threadId))
        return [...prev, ...page.threads.filter((t) => !have.has(t.threadId))]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch {
      // The threads already loaded are still good; do not replace them with an error.
      toast.error("Failed to load more conversations")
    } finally {
      setIsLoadingMore(false)
    }
  }

  const loadThreadMessages = async (threadId: string, cursor?: string) => {
    setMessagesLoading(true)
    setMessagesError(false)
    try {
      const page = await getPhoneThreadMessages(inboxId, threadId, { cursor })
      if (selectedRef.current !== threadId) return
      // Newest first: an older page goes after what is already held.
      setMessages((prev) => (cursor ? [...prev, ...page.messages] : page.messages))
      setMessagesCursor(page.hasMore ? page.nextCursor : null)
    } catch {
      if (selectedRef.current === threadId) setMessagesError(true)
    } finally {
      if (selectedRef.current === threadId) setMessagesLoading(false)
    }
  }

  const setThreadUnread = (threadId: string, unreadCount: number) =>
    setThreads((prev) => prev.map((t) => (t.threadId === threadId ? { ...t, unreadCount } : t)))

  const openThread = (thread: PhoneThread) => {
    selectedRef.current = thread.threadId
    setSelectedThreadId(thread.threadId)
    setSelectedFrom(thread.from)
    setShowThreadList(false)
    setMessages([])
    setMessagesCursor(null)
    void loadThreadMessages(thread.threadId)

    if (thread.unreadCount > 0) {
      // Optimistic, and put back if the server did not take it: a badge that says
      // read while the stored state says unread would be wrong on the next load.
      const unread = thread.unreadCount
      setThreadUnread(thread.threadId, 0)
      setPhoneThreadRead(inboxId, thread.threadId, true).catch(() =>
        setThreadUnread(thread.threadId, unread),
      )
    }
  }

  const backToList = () => {
    selectedRef.current = null
    setShowThreadList(true)
    setSelectedThreadId(null)
  }

  const refresh = async () => {
    await loadThreads()
    const open = selectedRef.current
    if (open) await loadThreadMessages(open)
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <MobileSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Threads - left pane */}
          <div className={cn(
            "w-full lg:w-96 border-r border-border flex flex-col bg-card",
            !showThreadList && "hidden lg:flex"
          )}>
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push("/phones")}
                  className="shrink-0"
                  aria-label="Back to numbers"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary shrink-0" />
                    <h2 className="font-semibold text-foreground truncate">{inbox?.phoneNumber ?? " "}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {status === "ready" ? `${threads.length}${hasMore ? "+" : ""} conversations` : " "}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void refresh()}
                  className="shrink-0"
                  aria-label="Refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2">
                {status === "loading" && (
                  <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                )}
                {status === "error" && (
                  <p className="p-4 text-sm text-destructive">Could not load messages. Try refreshing.</p>
                )}
                {status === "ready" && threads.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No messages yet. Texts sent to this number will appear here.
                  </p>
                )}
                {threads.map((thread) => (
                  <button
                    key={thread.threadId}
                    onClick={() => openThread(thread)}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left",
                      selectedThreadId === thread.threadId ? "bg-accent" : "hover:bg-muted/50"
                    )}
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-sm">
                        {initials(thread.from)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className={cn(
                          "text-sm truncate text-foreground",
                          thread.unreadCount > 0 ? "font-semibold" : "font-medium"
                        )}>
                          {thread.from}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0">{ago(thread.createdAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground truncate flex-1">
                          {preview(thread.body, thread.mediaCount)}
                        </p>
                        {thread.unreadCount > 0 && (
                          <Badge
                            aria-label={`${thread.unreadCount} unread`}
                            className="bg-primary text-primary-foreground h-5 min-w-5 px-1.5 text-xs shrink-0"
                          >
                            {thread.unreadCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {hasMore && (
                  <div className="p-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => void loadMoreThreads()}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? "Loading…" : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Thread - right pane */}
          <div className={cn(
            "flex-1 flex flex-col bg-background",
            showThreadList && "hidden lg:flex"
          )}>
            {selectedThreadId ? (
              <>
                <div className="p-4 border-b border-border bg-card">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={backToList} className="lg:hidden" aria-label="Back to conversations">
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                        {initials(selectedFrom)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{selectedFrom}</h3>
                    </div>
                  </div>
                </div>

                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4 max-w-3xl mx-auto" data-testid="thread-messages">
                    {messagesError && (
                      <p className="text-sm text-destructive">Could not load this conversation.</p>
                    )}
                    {messagesLoading && messages.length === 0 && (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    )}
                    {messagesCursor && (
                      <Button
                        variant="outline"
                        onClick={() => void loadThreadMessages(selectedThreadId, messagesCursor)}
                        disabled={messagesLoading}
                      >
                        Load older messages
                      </Button>
                    )}
                    {[...messages].reverse().map((message) => (
                      <div key={message.id} className="flex justify-start">
                        <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                          {message.body && (
                            <p className="text-sm text-foreground whitespace-pre-wrap break-words">{message.body}</p>
                          )}
                          {message.mediaCount > 0 && (
                            <p className="text-xs italic text-muted-foreground">{attachmentNote(message.mediaCount)}</p>
                          )}
                          {!message.body && message.mediaCount === 0 && (
                            <p className="text-xs italic text-muted-foreground">(empty message)</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">{ago(message.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="p-4 border-t border-border bg-card">
                  <p className="text-xs text-muted-foreground text-center">
                    This is a receive-only inbox. Sending messages is not available.
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <p>Select a conversation to view messages</p>
                <p className="text-xs">This is a receive-only inbox.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
