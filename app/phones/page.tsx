"use client"

import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { PhonesList } from "@/components/phones-list"

export default function PhonesPage() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <MobileSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Phone Numbers</h1>
              <p className="text-muted-foreground mt-2">
                Manage your temporary phone numbers and SMS messages
              </p>
            </div>
            <PhonesList />
          </div>
        </main>
      </div>
    </div>
  )
}
