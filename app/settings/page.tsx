"use client"

import { useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { changePassword, updateOrganization } from "@/lib/api/account.api"
import { toast } from "sonner"

export default function SettingsPage() {
  const { user, organizationId, refreshUser } = useAuth()
  const org = user?.organizations?.[0]

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  const [orgName, setOrgName] = useState(org?.name ?? "")
  const [savingOrg, setSavingOrg] = useState(false)

  // Keep orgName in sync once user loads (on first render org may be undefined)
  const displayOrgName = orgName || org?.name || ""

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match")
      return
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters")
      return
    }

    setSavingPassword(true)
    try {
      await changePassword(currentPassword, newPassword)
      toast.success("Password updated")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Failed to update password"
      setPasswordError(msg)
    } finally {
      setSavingPassword(false)
    }
  }

  const handleOrgSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return

    setSavingOrg(true)
    try {
      await updateOrganization(organizationId, displayOrgName)
      await refreshUser()
      toast.success("Organization name updated")
    } catch {
      toast.error("Failed to update organization name")
    } finally {
      setSavingOrg(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto px-4 py-8 lg:px-8 max-w-2xl">
          <h1 className="text-2xl font-semibold text-foreground mb-6">Settings</h1>

          {/* Account card */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Manage your login credentials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-1">
                <Label>Email</Label>
                <p className="text-sm text-foreground">{user?.email ?? "—"}</p>
              </div>

              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}
                <Button type="submit" disabled={savingPassword}>
                  {savingPassword ? "Saving…" : "Change password"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Organization card */}
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              <CardDescription>Update your organization&apos;s display name.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleOrgSave} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="orgName">Organization name</Label>
                  <Input
                    id="orgName"
                    value={displayOrgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={savingOrg}>
                  {savingOrg ? "Saving…" : "Save organization"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
