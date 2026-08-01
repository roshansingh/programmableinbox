import type { InboxEmail } from '@/lib/api/emails.api'

export const mockEmails: InboxEmail[] = [
  {
    id: 'email-1',
    organizationId: 'org-1',
    email: 'inbox-one@test.inboxui.com',
    name: 'Support Inbox',
    isOwner: true,
    createdAt: '2025-01-15T10:00:00.000Z',
    updatedAt: '2025-01-15T10:00:00.000Z',
  },
  {
    id: 'email-2',
    organizationId: 'org-1',
    email: 'inbox-two@test.inboxui.com',
    name: null,
    isOwner: true,
    createdAt: '2025-01-10T08:00:00.000Z',
    updatedAt: '2025-01-10T08:00:00.000Z',
  },
]
