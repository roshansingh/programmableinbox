import type { InboxPhone } from '@/lib/api/phones.api'

export const mockPhones: InboxPhone[] = [
  {
    id: 'phone-1',
    organizationId: 'org-1',
    userId: 'user-1',
    phoneNumber: '5551234567',
    countryCode: 'US',
    createdAt: '2025-01-15T10:00:00.000Z',
    updatedAt: '2025-01-15T10:00:00.000Z',
  },
  {
    id: 'phone-2',
    organizationId: 'org-1',
    userId: 'user-1',
    phoneNumber: '5559876543',
    countryCode: 'US',
    createdAt: '2025-01-10T08:00:00.000Z',
    updatedAt: '2025-01-10T08:00:00.000Z',
  },
]
