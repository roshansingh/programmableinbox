import type { ApiKeyListItem, CreatedApiKey } from '@/lib/api/api-keys.api'

// Old format for main branch tests
export const mockApiKeys = [
  {
    id: 'key-1',
    apiKey: 'sk_live_abcdefghijklmnop1234',
    name: 'Production Key',
    organizationId: 'org-1',
    userId: 'user-1',
    createdAt: '2025-01-15T10:00:00.000Z',
  },
  {
    id: 'key-2',
    apiKey: 'sk_test_qrstuvwxyz567890abcd',
    name: 'Development Key',
    organizationId: 'org-1',
    userId: 'user-1',
    createdAt: '2025-01-10T08:00:00.000Z',
  },
]

// New format for worktree tests with scopes
export const mockApiKeyList: ApiKeyListItem[] = [
  {
    id: 'key-1',
    prefix: 'sk_live_prod',
    name: 'Production Key',
    organizationId: 'org-1',
    userId: 'user-1',
    scopes: ['inboxes:read', 'messages:read'],
    createdAt: '2025-01-15T10:00:00.000Z',
  },
  {
    id: 'key-2',
    prefix: 'sk_test_dev',
    name: 'Development Key',
    organizationId: 'org-1',
    userId: 'user-1',
    scopes: ['inboxes:read'],
    createdAt: '2025-01-10T08:00:00.000Z',
  },
]

export const mockCreatedApiKey: CreatedApiKey = {
  id: 'key-new',
  prefix: 'sk_live_newk',
  apiKey: 'sk_live_newkeygenerated123456',
  name: 'My New Key',
  organizationId: 'org-1',
  userId: 'user-1',
  scopes: ['inboxes:read', 'messages:read'],
  createdAt: '2025-01-20T12:00:00.000Z',
}
