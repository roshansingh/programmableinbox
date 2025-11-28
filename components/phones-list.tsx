"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Phone, Copy, Trash2, ExternalLink } from 'lucide-react'
import { CreatePhoneDialog } from "@/components/create-phone-dialog"

interface PhoneNumber {
  id: string
  number: string
  country: string
  createdAt: string
  messageCount: number
  status: "active" | "expired"
}

export function PhonesList() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [phones, setPhones] = useState<PhoneNumber[]>([
    {
      id: "1",
      number: "+1 (555) 123-4567",
      country: "US",
      createdAt: "1 hour ago",
      messageCount: 8,
      status: "active",
    },
    {
      id: "2",
      number: "+1 (555) 987-6543",
      country: "US",
      createdAt: "5 hours ago",
      messageCount: 3,
      status: "active",
    },
    {
      id: "3",
      number: "+44 7700 900123",
      country: "UK",
      createdAt: "2 days ago",
      messageCount: 15,
      status: "active",
    },
  ])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const deletePhone = (id: string) => {
    setPhones(phones.filter((phone) => phone.id !== id))
  }

  return (
    <>
      <Card className="bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground">Phone Numbers</CardTitle>
              <CardDescription>Manage your temporary phone numbers</CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              Create
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
                      {phone.number}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                        {phone.country}
                      </Badge>
                      <span className="text-muted-foreground">•</span>
                      <p className="text-xs text-muted-foreground">{phone.createdAt}</p>
                      <span className="text-muted-foreground">•</span>
                      <p className="text-xs text-muted-foreground">
                        {phone.messageCount} SMS
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={phone.status === "active" ? "default" : "secondary"} className="bg-primary/20 text-primary hover:bg-primary/30">
                    {phone.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(phone.number)}
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
                    onClick={() => deletePhone(phone.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
      <CreatePhoneDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </>
  )
}
