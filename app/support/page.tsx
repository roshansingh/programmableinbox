"use client"

import { LifeBuoy, Mail, Clock } from 'lucide-react'
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function SupportPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto px-4 py-8 lg:px-8 max-w-2xl">
          <h1 className="text-2xl font-semibold text-foreground mb-6">Support</h1>

          <Card>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                <LifeBuoy className="h-5 w-5" />
              </div>
              <CardTitle>Need help?</CardTitle>
              <CardDescription>
                Email us and a real person will get back to you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <a
                href="mailto:support@programmableinbox.com"
                className="flex items-center gap-3 text-sm font-medium text-primary hover:underline"
              >
                <Mail className="h-4 w-4 shrink-0" />
                support@programmableinbox.com
              </a>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" />
                We usually reply within about 6 hours.
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
