import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { StatsCards } from "@/components/stats-cards"
import { EmailsList } from "@/components/emails-list"
export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto px-4 py-6 space-y-6 lg:px-8 lg:py-8 lg:space-y-8">
          <StatsCards />
          <EmailsList />
        </main>
      </div>
    </div>
  )
}
