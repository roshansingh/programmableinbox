"use client"

import { useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, Trash2, Archive, Star, Reply, Forward, MoreVertical, Mail, ChevronDown, ChevronUp, Inbox, Send, AlertTriangle, Trash } from 'lucide-react'
import { useRouter, useParams } from 'next/navigation'
import { formatDistanceToNow } from "date-fns"

interface EmailMessage {
  id: string
  from: string
  fromEmail: string
  subject: string
  preview: string
  body: string
  date: Date
  unread: boolean
  hasAttachment: boolean
  threadId: string
  folder: "inbox" | "sent" | "spam" | "trash"
  threadMessages?: EmailMessage[]
}

export default function InboxPage() {
  const router = useRouter()
  const params = useParams()
  const emailId = params.id

  const inboxAddress = "temp.5f8a2b@inbox.dev"
  
  const [currentFolder, setCurrentFolder] = useState<"inbox" | "sent" | "spam" | "trash">("inbox")
  
  const [allMessages] = useState<EmailMessage[]>([
    // Inbox messages
    {
      id: "1",
      threadId: "thread-1",
      from: "GitHub",
      fromEmail: "notifications@github.com",
      subject: "New security alert for your repository",
      preview: "We've detected a potential security vulnerability in one of your dependencies...",
      body: `Hi there,

We've detected a potential security vulnerability in one of your dependencies. This is an automated notification to help you keep your projects secure.

**Repository:** my-awesome-project
**Severity:** Medium
**Package:** lodash@4.17.20

We recommend updating to the latest version to address this issue. You can view more details in your repository's security tab.

Best regards,
The GitHub Team`,
      date: new Date(Date.now() - 2 * 60 * 60 * 1000),
      unread: true,
      hasAttachment: false,
      folder: "inbox",
    },
    {
      id: "2",
      threadId: "thread-2",
      from: "Sarah Mitchell",
      fromEmail: "sarah.mitchell@company.com",
      subject: "Re: Project proposal feedback",
      preview: "Thanks for sharing the proposal. I've reviewed it and have a few suggestions...",
      body: `Hi,

Thanks for sharing the proposal. I've reviewed it and have a few suggestions that I think could strengthen it:

1. Add more specific metrics for success
2. Include a timeline breakdown
3. Consider budget allocation for each phase

Let me know if you'd like to schedule a call to discuss these points in more detail.

Best,
Sarah`,
      date: new Date(Date.now() - 5 * 60 * 60 * 1000),
      unread: true,
      hasAttachment: false,
      folder: "inbox",
      threadMessages: [
        {
          id: "2a",
          threadId: "thread-2",
          from: "You",
          fromEmail: inboxAddress,
          subject: "Re: Project proposal feedback",
          preview: "Here's the updated proposal with your suggestions incorporated...",
          body: `Hi Sarah,

Thank you for the feedback! I've incorporated all your suggestions:

1. Added KPIs and success metrics for each phase
2. Created a detailed 6-month timeline with milestones
3. Broke down the budget by phase and deliverable

I've attached the updated proposal. Let me know if you'd like to discuss further!

Best regards`,
          date: new Date(Date.now() - 4 * 60 * 60 * 1000),
          unread: false,
          hasAttachment: true,
          folder: "sent",
        },
        {
          id: "2b",
          threadId: "thread-2",
          from: "Sarah Mitchell",
          fromEmail: "sarah.mitchell@company.com",
          subject: "Re: Project proposal feedback",
          preview: "This looks much better! Just one more thing...",
          body: `Perfect!

This looks much better! Just one more thing - can we add a risk assessment section? I think stakeholders will appreciate seeing that we've thought through potential challenges.

Otherwise, I'm happy to approve this and move forward.

Sarah`,
          date: new Date(Date.now() - 3 * 60 * 60 * 1000),
          unread: false,
          hasAttachment: false,
          folder: "inbox",
        },
      ],
    },
    {
      id: "3",
      threadId: "thread-3",
      from: "LinkedIn",
      fromEmail: "messages-noreply@linkedin.com",
      subject: "You have 3 new connection requests",
      preview: "People are interested in connecting with you on LinkedIn...",
      body: `Hi there,

You have 3 new connection requests waiting for your response:

• John Doe - Software Engineer at Tech Corp
• Jane Smith - Product Manager at Startup Inc
• Mike Johnson - Designer at Creative Agency

Visit LinkedIn to accept or ignore these requests.

Best regards,
The LinkedIn Team`,
      date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: false,
      folder: "inbox",
    },
    {
      id: "4",
      threadId: "thread-4",
      from: "Stripe",
      fromEmail: "receipts@stripe.com",
      subject: "Payment receipt for your subscription",
      preview: "Your payment of $29.00 was successful...",
      body: `Hello,

Your payment of $29.00 was successful. Here are the details:

**Transaction ID:** ch_3NXbX8FJ7a8b9c0d
**Amount:** $29.00
**Date:** ${new Date().toLocaleDateString()}
**Payment Method:** Visa ending in 4242

You can view your full invoice by clicking the link below.

Thank you for your business!

The Stripe Team`,
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: true,
      folder: "inbox",
    },
    {
      id: "5",
      threadId: "thread-5",
      from: "Amazon Web Services",
      fromEmail: "no-reply@aws.amazon.com",
      subject: "Monthly billing statement",
      preview: "Your AWS bill for this month is ready...",
      body: `Dear Customer,

Your AWS bill for this month is ready. Here's a summary:

**Total Amount:** $127.45
**Billing Period:** ${new Date().toLocaleDateString()}
**Services Used:**
- EC2: $45.00
- S3: $12.50
- RDS: $69.95

You can view your detailed billing statement in the AWS Console.

AWS Billing Team`,
      date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: true,
      folder: "inbox",
    },
    // Sent messages
    {
      id: "6",
      threadId: "thread-6",
      from: "You",
      fromEmail: inboxAddress,
      subject: "Meeting follow-up and action items",
      preview: "Thank you for attending today's meeting. Here are the key takeaways...",
      body: `Hi Team,

Thank you for attending today's meeting. Here are the key takeaways and action items:

**Decisions Made:**
- Approved the new feature roadmap
- Selected technology stack for Q2 projects
- Confirmed budget allocation

**Action Items:**
- John: Prepare technical spec by Friday
- Sarah: Schedule follow-up with stakeholders
- Mike: Begin UI/UX mockups

Let me know if I missed anything.

Best regards`,
      date: new Date(Date.now() - 6 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: false,
      folder: "sent",
    },
    {
      id: "7",
      threadId: "thread-7",
      from: "You",
      fromEmail: inboxAddress,
      subject: "Question about API documentation",
      preview: "I'm reviewing the API docs and have a few questions...",
      body: `Hi Support Team,

I'm reviewing the API documentation and have a few questions:

1. What's the rate limit for the /users endpoint?
2. Is pagination supported for large datasets?
3. How do I handle authentication tokens?

Thanks for your help!

Best regards`,
      date: new Date(Date.now() - 12 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: false,
      folder: "sent",
    },
    // Spam messages
    {
      id: "8",
      threadId: "thread-8",
      from: "Promotional Deals",
      fromEmail: "deals@marketing-spam.com",
      subject: "🎉 MEGA SALE! 90% OFF Everything! Limited Time!",
      preview: "Don't miss out on this incredible opportunity! Save big on...",
      body: `🎉 MEGA SALE ALERT! 🎉

You've been selected for our EXCLUSIVE 90% OFF sale!

Act now and save on:
- Electronics
- Fashion
- Home goods
- And MORE!

Click here to claim your discount before it expires!

*This is a promotional email. Terms and conditions apply.`,
      date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: false,
      folder: "spam",
    },
    {
      id: "9",
      threadId: "thread-9",
      from: "Crypto Investment",
      fromEmail: "invest@crypto-scam.xyz",
      subject: "You've been selected for exclusive crypto opportunity",
      preview: "Congratulations! You've been chosen to participate in our exclusive...",
      body: `Congratulations!

You've been selected for our exclusive crypto investment program. Guaranteed returns of 500% in just 30 days!

Our AI-powered trading bot ensures:
✓ Zero risk
✓ Massive profits
✓ Instant withdrawals

Send your investment today!

*Not financial advice. Past performance doesn't guarantee future results.`,
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      unread: true,
      hasAttachment: false,
      folder: "spam",
    },
    // Trash messages
    {
      id: "10",
      threadId: "thread-10",
      from: "Newsletter Weekly",
      fromEmail: "news@oldnewsletter.com",
      subject: "Weekly digest - January 2024",
      preview: "Your weekly roundup of news and updates...",
      body: `Weekly Digest - January 2024

Here's what happened this week:

• Technology trends update
• Industry news roundup
• Upcoming events calendar

Thanks for subscribing!`,
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: false,
      folder: "trash",
    },
    {
      id: "11",
      threadId: "thread-11",
      from: "Old Account",
      fromEmail: "notifications@oldservice.com",
      subject: "Account reminder",
      preview: "This is a reminder about your old account...",
      body: `Account Reminder

This is a reminder about your account with Old Service. 

If you no longer need this account, you can close it at any time.

Thanks,
Old Service Team`,
      date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      unread: false,
      hasAttachment: false,
      folder: "trash",
    },
  ])

  const messages = allMessages.filter(msg => msg.folder === currentFolder)
  
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage>(messages[0])
  const [expandedThreadMessages, setExpandedThreadMessages] = useState<Set<string>>(new Set())
  const [showMessageDetail, setShowMessageDetail] = useState(false)

  const handleFolderChange = (folder: "inbox" | "sent" | "spam" | "trash") => {
    setCurrentFolder(folder)
    const folderMessages = allMessages.filter(msg => msg.folder === folder)
    if (folderMessages.length > 0) {
      setSelectedMessage(folderMessages[0])
    }
    setShowMessageDetail(false)
  }

  const getFolderIcon = (folder: string) => {
    switch (folder) {
      case "inbox": return <Inbox className="h-4 w-4" />
      case "sent": return <Send className="h-4 w-4" />
      case "spam": return <AlertTriangle className="h-4 w-4" />
      case "trash": return <Trash className="h-4 w-4" />
      default: return <Inbox className="h-4 w-4" />
    }
  }

  const getFolderLabel = (folder: string) => {
    return folder.charAt(0).toUpperCase() + folder.slice(1)
  }

  const toggleThreadMessage = (messageId: string) => {
    const newExpanded = new Set(expandedThreadMessages)
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId)
    } else {
      newExpanded.add(messageId)
    }
    setExpandedThreadMessages(newExpanded)
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
                <span className="font-mono text-xs lg:text-sm font-medium text-foreground truncate">{inboxAddress}</span>
              </div>
            </div>
          </div>

          <div className="flex h-[calc(100vh-9rem)] overflow-hidden">
            {/* Message list - visible on desktop always, on mobile only when not showing detail */}
            <div className={`w-full lg:w-96 border-r border-border bg-card ${showMessageDetail ? 'hidden lg:block' : 'block'}`}>
              <div className="border-b border-border">
                <Tabs value={currentFolder} onValueChange={(value) => handleFolderChange(value as "inbox" | "sent" | "spam" | "trash")} className="w-full">
                  <TabsList className="w-full h-auto p-0 bg-transparent rounded-none grid grid-cols-4">
                    <TabsTrigger 
                      value="inbox" 
                      className="data-[state=active]:bg-muted data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none py-3 gap-2"
                    >
                      <Inbox className="h-4 w-4" />
                      <span className="hidden sm:inline">Inbox</span>
                    </TabsTrigger>
                    <TabsTrigger 
                      value="sent"
                      className="data-[state=active]:bg-muted data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none py-3 gap-2"
                    >
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">Sent</span>
                    </TabsTrigger>
                    <TabsTrigger 
                      value="spam"
                      className="data-[state=active]:bg-muted data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none py-3 gap-2"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      <span className="hidden sm:inline">Spam</span>
                    </TabsTrigger>
                    <TabsTrigger 
                      value="trash"
                      className="data-[state=active]:bg-muted data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none py-3 gap-2"
                    >
                      <Trash className="h-4 w-4" />
                      <span className="hidden sm:inline">Trash</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  {getFolderIcon(currentFolder)}
                  <h2 className="font-semibold text-foreground">{getFolderLabel(currentFolder)}</h2>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{messages.length} messages</p>
              </div>
              
              <ScrollArea className="h-[calc(100%-8.5rem)]">
                <div className="divide-y divide-border">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      onClick={() => {
                        setSelectedMessage(message)
                        setShowMessageDetail(true)
                      }}
                      className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedMessage.id === message.id ? "bg-muted/50 border-l-2 border-primary" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className={`text-sm font-medium truncate ${message.unread ? "text-foreground" : "text-muted-foreground"}`}>
                          {message.from}
                        </p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(message.date, { addSuffix: true })}
                        </span>
                      </div>
                      <p className={`text-sm truncate mb-1 ${message.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {message.subject}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {message.preview}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {message.unread && (
                          <Badge variant="default" className="text-xs bg-primary/20 text-primary hover:bg-primary/30">
                            Unread
                          </Badge>
                        )}
                        {message.hasAttachment && (
                          <Badge variant="outline" className="text-xs">
                            Attachment
                          </Badge>
                        )}
                        {message.threadMessages && message.threadMessages.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {message.threadMessages.length + 1} messages
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Message detail pane - unchanged */}
            <div className={`flex-1 flex-col bg-background overflow-hidden ${showMessageDetail ? 'flex' : 'hidden lg:flex'}`}>
              {selectedMessage ? (
                <>
                  {/* Message header */}
                  <div className="border-b border-border bg-card px-4 lg:px-6 py-4 flex-shrink-0">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h1 className="text-lg lg:text-xl font-semibold text-foreground mb-2 text-balance">
                          {selectedMessage.subject}
                        </h1>
                        {selectedMessage.threadMessages && selectedMessage.threadMessages.length > 0 && (
                          <p className="text-xs text-muted-foreground mb-2">
                            {selectedMessage.threadMessages.length + 1} messages in this conversation
                          </p>
                        )}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm">
                          <span className="font-medium text-foreground truncate">{selectedMessage.from}</span>
                          <span className="text-muted-foreground text-xs sm:text-sm truncate">&lt;{selectedMessage.fromEmail}&gt;</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {selectedMessage.date.toLocaleString()}
                        </p>
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
                      <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto">
                        <Reply className="h-3 w-3 mr-2" />
                        Reply
                      </Button>
                      <Button variant="outline" size="sm" className="w-full sm:w-auto">
                        <Forward className="h-3 w-3 mr-2" />
                        Forward
                      </Button>
                    </div>
                  </div>

                  {/* Message body with thread view */}
                  <ScrollArea className="flex-1 overflow-auto">
                    <div className="px-4 lg:px-6 py-4 lg:py-6 space-y-4">
                      <div className="border border-border rounded-lg bg-card">
                        <div className="border-b border-border px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-xs font-semibold text-primary">
                                  {selectedMessage.from.charAt(0)}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{selectedMessage.from}</p>
                                <p className="text-xs text-muted-foreground truncate">{selectedMessage.fromEmail}</p>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDistanceToNow(selectedMessage.date, { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                        <div className="px-4 py-4">
                          <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                            {selectedMessage.body}
                          </pre>
                        </div>
                      </div>

                      {selectedMessage.threadMessages && selectedMessage.threadMessages.map((threadMsg, index) => (
                        <div key={threadMsg.id} className="border border-border rounded-lg bg-card">
                          <div 
                            className="border-b border-border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => toggleThreadMessage(threadMsg.id)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <span className="text-xs font-semibold text-primary">
                                    {threadMsg.from.charAt(0)}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{threadMsg.from}</p>
                                  {!expandedThreadMessages.has(threadMsg.id) && (
                                    <p className="text-xs text-muted-foreground truncate">{threadMsg.preview}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
                                  {formatDistanceToNow(threadMsg.date, { addSuffix: true })}
                                </span>
                                {expandedThreadMessages.has(threadMsg.id) ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </div>
                          {expandedThreadMessages.has(threadMsg.id) && (
                            <div className="px-4 py-4 border-t border-border">
                              <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                                {threadMsg.body}
                              </pre>
                              {threadMsg.hasAttachment && (
                                <div className="mt-3 pt-3 border-t border-border">
                                  <Badge variant="outline" className="text-xs">
                                    📎 Attachment
                                  </Badge>
                                </div>
                              )}
                              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-4">
                                <Button size="sm" variant="outline" className="w-full sm:w-auto">
                                  <Reply className="h-3 w-3 mr-2" />
                                  Reply
                                </Button>
                                <Button size="sm" variant="outline" className="w-full sm:w-auto">
                                  <Forward className="h-3 w-3 mr-2" />
                                  Forward
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
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
    </div>
  )
}
