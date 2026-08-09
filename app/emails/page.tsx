import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { EmailsList } from "@/components/emails-list"

export default function EmailsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto px-4 py-6 space-y-6 lg:px-8 lg:py-8">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Email Inboxes</h1>
            <p className="text-sm lg:text-base text-muted-foreground mt-2">
              Manage all your programmable email addresses in one place
            </p>
          </div>
          <EmailsList />
        </main>
      </div>
    </div>
  )
}
