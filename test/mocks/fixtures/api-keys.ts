import type { ApiKey } from '@/lib/api/api-keys.api'

export const mockApiKeys: ApiKey[] = [
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
