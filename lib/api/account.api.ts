import { apiClient } from '@/lib/api-client'

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.patch('/app/account/password', { currentPassword, newPassword })
}

export async function updateOrganization(
  organizationId: string,
  name: string
): Promise<{ id: string; name: string; slug: string }> {
  return apiClient.patch('/app/account/organization', { organizationId, name })
}
