"use client"

import { useState } from "react"
import { useParams, useRouter } from 'next/navigation'
import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Search, Phone } from 'lucide-react'
import { cn } from "@/lib/utils"

interface Conversation {
  id: string
  sender: string
  phone: string
  lastMessage: string
  timestamp: string
  unread: number
  avatar: string
}

const conversations: Conversation[] = [
  {
    id: "1",
    sender: "Bank of America",
    phone: "+1 (800) 432-1000",
    lastMessage: "Your verification code is 849321. Valid for 5 minutes.",
    timestamp: "2m ago",
    unread: 1,
    avatar: "BA",
  },
  {
    id: "2",
    sender: "Uber",
    phone: "+1 (415) 555-0100",
    lastMessage: "Your driver John is arriving in 3 minutes. White Toyota Camry.",
    timestamp: "15m ago",
    unread: 0,
    avatar: "U",
  },
  {
    id: "3",
    sender: "Amazon",
    phone: "+1 (206) 555-0199",
    lastMessage: "Your package has been delivered. Thank you for shopping with us!",
    timestamp: "1h ago",
    unread: 0,
    avatar: "A",
  },
  {
    id: "4",
    sender: "DoorDash",
    phone: "+1 (855) 222-8111",
    lastMessage: "Your order from Chipotle is on the way! ETA: 25 minutes.",
    timestamp: "3h ago",
    unread: 2,
    avatar: "DD",
  },
  {
    id: "5",
    sender: "LinkedIn",
    phone: "+1 (650) 555-0150",
    lastMessage: "You have 5 new connection requests waiting for you.",
    timestamp: "Yesterday",
    unread: 0,
    avatar: "L",
  },
  {
    id: "6",
    sender: "Airbnb",
    phone: "+1 (415) 555-0200",
    lastMessage: "Your reservation is confirmed! Check-in: March 15, 2025",
    timestamp: "Yesterday",
    unread: 0,
    avatar: "AB",
  },
]

export default function PhoneMessagesPage() {
  const params = useParams()
  const router = useRouter()
  const [selectedConversation, setSelectedConversation] = useState<string | null>(conversations[0].id)
  const [showMessageList, setShowMessageList] = useState(true)

  const phoneNumber = "+1 (555) 123-4567"

  const handleConversationClick = (id: string) => {
    setSelectedConversation(id)
    setShowMessageList(false)
  }

  const handleBackToList = () => {
    setShowMessageList(true)
    setSelectedConversation(null)
  }

  const selectedConv = conversations.find((c) => c.id === selectedConversation)

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <MobileSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Conversations List - Left Pane */}
          <div className={cn(
            "w-full lg:w-96 border-r border-border flex flex-col bg-card",
            !showMessageList && "hidden lg:flex"
          )}>
            {/* Header */}
            <div className="p-4 border-b border-border space-y-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push("/phones")}
                  className="shrink-0"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary shrink-0" />
                    <h2 className="font-semibold text-foreground truncate">{phoneNumber}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {conversations.length} conversations
                  </p>
                </div>
              </div>
              
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search messages..."
                  className="pl-9 bg-muted/50"
                />
              </div>
            </div>

            {/* Conversations List */}
            <ScrollArea className="flex-1">
              <div className="p-2">
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => handleConversationClick(conversation.id)}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left",
                      selectedConversation === conversation.id
                        ? "bg-accent"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-sm">
                        {conversation.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-medium text-foreground text-sm truncate">
                          {conversation.sender}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {conversation.timestamp}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1 truncate">
                        {conversation.phone}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground truncate flex-1">
                          {conversation.lastMessage}
                        </p>
                        {conversation.unread > 0 && (
                          <Badge className="bg-primary text-primary-foreground h-5 min-w-5 px-1.5 text-xs shrink-0">
                            {conversation.unread}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Message Thread - Right Pane */}
          <div className={cn(
            "flex-1 flex flex-col bg-background",
            showMessageList && "hidden lg:flex"
          )}>
            {selectedConv ? (
              <>
                {/* Thread Header */}
                <div className="p-4 border-b border-border bg-card">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleBackToList}
                      className="lg:hidden"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                        {selectedConv.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">
                        {selectedConv.sender}
                      </h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {selectedConv.phone}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4 max-w-3xl mx-auto">
                    {/* Sample messages based on conversation */}
                    {selectedConv.id === "1" && (
                      <>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your verification code is 849321. Valid for 5 minutes.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">2:34 PM</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Do not share this code with anyone.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">2:34 PM</p>
                          </div>
                        </div>
                      </>
                    )}
                    {selectedConv.id === "2" && (
                      <>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your Uber is on the way! John will arrive in 8 minutes.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">1:20 PM</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your driver John is arriving in 3 minutes. White Toyota Camry.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">1:25 PM</p>
                          </div>
                        </div>
                      </>
                    )}
                    {selectedConv.id === "3" && (
                      <>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your package is out for delivery today.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">10:15 AM</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your package has been delivered. Thank you for shopping with us!
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">11:42 AM</p>
                          </div>
                        </div>
                      </>
                    )}
                    {selectedConv.id === "4" && (
                      <>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your order from Chipotle has been confirmed!
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">9:15 AM</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your order is being prepared. ETA: 35 minutes.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">9:20 AM</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your order from Chipotle is on the way! ETA: 25 minutes.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">9:25 AM</p>
                          </div>
                        </div>
                      </>
                    )}
                    {selectedConv.id === "5" && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                          <p className="text-sm text-foreground">
                            You have 5 new connection requests waiting for you.
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Yesterday</p>
                        </div>
                      </div>
                    )}
                    {selectedConv.id === "6" && (
                      <>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your reservation request has been received.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Yesterday 3:00 PM</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <p className="text-sm text-foreground">
                              Your reservation is confirmed! Check-in: March 15, 2025
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">Yesterday 4:30 PM</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-4 border-t border-border bg-card">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Type a message..."
                      className="flex-1"
                      disabled
                    />
                    <Button disabled>Send</Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    This is a receive-only inbox. Sending messages is not available.
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p>Select a conversation to view messages</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
