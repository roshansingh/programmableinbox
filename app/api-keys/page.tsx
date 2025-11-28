"use client"

import { useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Copy, Eye, EyeOff, MoreVertical, Plus, Trash2, Key } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

interface ApiKey {
  id: string
  name: string
  key: string
  createdAt: string
  lastUsed: string | null
  status: "active" | "inactive"
}

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([
    {
      id: "1",
      name: "Production API Key",
      key: "pk_live_51Abc123XyZ789DefGhi456JklMno789PqrStu012VwxYza345BcdEfg678Hij901Klm234Nop567Qrs890Tuv",
      createdAt: "2024-01-15",
      lastUsed: "2 hours ago",
      status: "active",
    },
    {
      id: "2",
      name: "Development API Key",
      key: "pk_test_51Xyz987Abc123Def456Ghi789Jkl012Mno345Pqr678Stu901Vwx234Yza567Bcd890Efg123Hij456Klm789Nop",
      createdAt: "2024-01-10",
      lastUsed: "1 day ago",
      status: "active",
    },
    {
      id: "3",
      name: "Testing Environment",
      key: "pk_test_51Def123Ghi456Jkl789Mno012Pqr345Stu678Vwx901Yza234Bcd567Efg890Hij123Klm456Nop789Qrs012Tuv",
      createdAt: "2023-12-20",
      lastUsed: null,
      status: "inactive",
    },
  ])
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const maskKey = (key: string) => {
    return key.slice(0, 12) + "..." + key.slice(-4)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const deleteKey = (id: string) => {
    setApiKeys((prev) => prev.filter((key) => key.id !== id))
  }

  const createApiKey = () => {
    if (!newKeyName.trim()) return

    const newKey = {
      id: Date.now().toString(),
      name: newKeyName,
      key: `pk_live_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`,
      createdAt: new Date().toISOString().split("T")[0],
      lastUsed: null,
      status: "active" as const,
    }

    setApiKeys((prev) => [newKey, ...prev])
    setCreatedKey(newKey.key)
    setNewKeyName("")
  }

  const closeCreateDialog = () => {
    setIsCreateOpen(false)
    setCreatedKey(null)
    setNewKeyName("")
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <DashboardHeader />

        <main className="flex-1 overflow-y-auto px-4 py-6 space-y-6 lg:px-8 lg:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">API Keys</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage your API keys for programmatic access
              </p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create API Key
                </Button>
              </DialogTrigger>
              <DialogContent>
                {!createdKey ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>Create New API Key</DialogTitle>
                      <DialogDescription>
                        Give your API key a descriptive name to help identify its purpose.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">API Key Name</Label>
                        <Input
                          id="name"
                          placeholder="e.g., Production API Key"
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={closeCreateDialog}>
                        Cancel
                      </Button>
                      <Button onClick={createApiKey} disabled={!newKeyName.trim()}>
                        Create Key
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>API Key Created</DialogTitle>
                      <DialogDescription>
                        Copy your API key now. You won't be able to see it again!
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Your API Key</Label>
                        <div className="flex gap-2">
                          <Input value={createdKey} readOnly className="font-mono text-sm" />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(createdKey)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                        <p className="text-sm text-amber-600 dark:text-amber-500">
                          Make sure to copy your API key now. You won't be able to see it again!
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={closeCreateDialog}>Done</Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {apiKeys.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Key className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No API Keys</h3>
                  <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                    Create your first API key to start using the programmable inbox API.
                  </p>
                  <Button onClick={() => setIsCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create API Key
                  </Button>
                </CardContent>
              </Card>
            ) : (
              apiKeys.map((apiKey) => (
                <Card key={apiKey.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{apiKey.name}</CardTitle>
                          <Badge variant={apiKey.status === "active" ? "default" : "secondary"}>
                            {apiKey.status}
                          </Badge>
                        </div>
                        <CardDescription>
                          Created on {apiKey.createdAt}
                          {apiKey.lastUsed && ` • Last used ${apiKey.lastUsed}`}
                        </CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteKey(apiKey.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Key
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-md px-3 py-2 font-mono text-sm overflow-hidden">
                        {visibleKeys[apiKey.id] ? apiKey.key : maskKey(apiKey.key)}
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => toggleKeyVisibility(apiKey.id)}
                      >
                        {visibleKeys[apiKey.id] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(apiKey.key)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
