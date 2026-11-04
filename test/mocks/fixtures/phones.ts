import type { InboxPhone } from '@/lib/api/phones.api'

export const mockPhones: InboxPhone[] = [
  {
    id: 'phone-1',
    organizationId: 'org-1',
    phoneNumber: '+15551234567',
    countryCode: 'US',
    status: 'active',
    capabilities: { sms: true, mms: false, voice: true },
    isOwner: true,
    createdAt: '2025-01-15T10:00:00.000Z',
    updatedAt: '2025-01-15T10:00:00.000Z',
  },
  {
    // A teammate's number: visible, but not the viewer's to release.
    id: 'phone-2',
    organizationId: 'org-1',
    phoneNumber: '+15559876543',
    countryCode: 'US',
    status: 'active',
    capabilities: { sms: true, mms: false, voice: true },
    isOwner: false,
    createdAt: '2025-01-10T08:00:00.000Z',
    updatedAt: '2025-01-10T08:00:00.000Z',
  },
]

export const mockAvailableNumbers = [
  { phoneNumber: '+14155550100', locality: 'San Francisco', region: 'CA' },
  { phoneNumber: '+14155550101', locality: 'Oakland', region: 'CA' },
]
