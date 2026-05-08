import type { User, Organization } from '@/lib/api/auth.api'

export const mockOrganization: Organization = {
  id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  role: 'owner',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

export const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  emailVerified: true,
  organizations: [mockOrganization],
}
