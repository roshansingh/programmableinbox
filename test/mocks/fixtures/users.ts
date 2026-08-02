import type { User, Organization, AppConfig } from '@/lib/api/auth.api'

/**
 * Two domains, so the default fixture exercises the picker branch of the create
 * dialog. Tests that need the single-domain or unconfigured branch override the
 * `/app/auth/me` handler per test.
 */
export const mockAppConfig: AppConfig = {
  emailInboxDomains: ['inbox.example.com', 'mail.example.com'],
  // The default deployment posture — verification off, behaviour unchanged.
  // The AuthGuard suite overrides `/app/auth/me` to flip this on.
  emailVerificationRequired: false,
}

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
  config: mockAppConfig,
}
