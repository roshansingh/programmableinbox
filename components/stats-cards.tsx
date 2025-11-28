import { Mail, Phone, MessageSquare, Clock } from 'lucide-react'
import { Card, CardContent } from "@/components/ui/card"

export function StatsCards() {
  const stats = [
    {
      label: "Active Emails",
      value: "12",
      icon: Mail,
      change: "+3 this week",
    },
    {
      label: "Active Numbers",
      value: "5",
      icon: Phone,
      change: "+1 this week",
    },
    {
      label: "Messages Received",
      value: "248",
      icon: MessageSquare,
      change: "+42 today",
    },
    {
      label: "Avg. Response Time",
      value: "2.3s",
      icon: Clock,
      change: "Fast delivery",
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="bg-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.change}</p>
              </div>
              <div className="rounded-full bg-primary/10 p-3">
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
