import { apiClient } from '../api-client'

export interface DashboardStats {
  emailInboxes: number
  emailsToday: number
  apiKeys: number
  activeAutomations: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return apiClient.get<DashboardStats>('/v1/stats')
}
