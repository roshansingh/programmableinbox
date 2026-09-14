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
        <main className="flex-1 overflow-y-auto px-4 py-8 lg:px-8">
          <div className="mx-auto w-full max-w-xl">
            <Card>
              <CardHeader className="items-center text-center pt-10 pb-2">
                <div className="flex items-center justify-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <LifeBuoy className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-2xl">Support</CardTitle>
                </div>
                <CardDescription className="text-base mt-2">
                  Email us and a real person will get back to you.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4 pb-10">
                <a
                  href="mailto:support@programmableinbox.com"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  support@programmableinbox.com
                </a>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0" />
                  We usually reply within about 6 hours.
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}
