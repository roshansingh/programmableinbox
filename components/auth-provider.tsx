"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { getCurrentUser, type User } from "@/lib/api/auth.api"

interface AuthContextValue {
  user: User | null
  organizationId: string | null
  isLoading: boolean
  isAuthenticated: boolean
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const organizationId = user?.organizations?.[0]?.id ?? null

  const refreshUser = async () => {
    try {
      const userData = await getCurrentUser()
      setUser(userData)
      setIsAuthenticated(true)
    } catch {
      setUser(null)
      setIsAuthenticated(false)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshUser()
  }, [])

  return (
    <AuthContext.Provider value={{ user, organizationId, isLoading, isAuthenticated, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
