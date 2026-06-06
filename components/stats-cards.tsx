"use client"

import { useEffect, useState } from 'react'
import { Mail, MessageSquare, Key, Workflow } from 'lucide-react'
import { Card, CardContent } from "@/components/ui/card"
import { getDashboardStats, type DashboardStats } from "@/lib/api/stats.api"

const CARDS = [
  {
    key: 'emailInboxes' as const,
    label: 'Email Inboxes',
    icon: Mail,
  },
  {
    key: 'emailsToday' as const,
    label: 'Emails Today',
    icon: MessageSquare,
  },
  {
    key: 'apiKeys' as const,
    label: 'API Keys',
    icon: Key,
  },
  {
    key: 'activeAutomations' as const,
    label: 'Active Automations',
    icon: Workflow,
  },
]

export function StatsCards() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch(() => {})
  }, [])

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {CARDS.map(({ key, label, icon: Icon }) => (
        <Card key={key} className="bg-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="text-3xl font-bold text-foreground">
                  {stats === null ? '—' : stats[key]}
                </p>
              </div>
              <div className="rounded-full bg-primary/10 p-3">
                <Icon className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
