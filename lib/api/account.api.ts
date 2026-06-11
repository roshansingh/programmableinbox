import { apiClient } from './api-client'

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.patch('/v1/account/password', { currentPassword, newPassword })
}

export async function updateOrganization(
  organizationId: string,
  name: string
): Promise<{ id: string; name: string; slug: string }> {
  return apiClient.patch('/v1/account/organization', { organizationId, name })
}
