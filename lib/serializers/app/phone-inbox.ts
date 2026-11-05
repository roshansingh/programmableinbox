/**
 * Dashboard response shape for a phone inbox. Explicit allowlist, not a model
 * spread, so a new column is a deliberate addition.
 *
 * `isOwner` exists because reads are organization-wide while release is
 * creator-only: a teammate sees numbers they cannot delete. The raw `userId`
 * and the provider's `providerId` are not exposed.
 */
type PhoneInboxRow = {
  id: string
  organizationId: string
  userId: string
  phoneNumber: string
  countryCode: string
  status: 'pending' | 'active' | 'released' | 'failed'
  capabilities: unknown
  createdAt: Date
  updatedAt: Date
}

export function serializeAppPhoneInbox(inbox: PhoneInboxRow, viewerUserId: string) {
  return {
    id: inbox.id,
    organizationId: inbox.organizationId,
    phoneNumber: inbox.phoneNumber,
    countryCode: inbox.countryCode,
    status: inbox.status,
    capabilities: inbox.capabilities ?? null,
    isOwner: inbox.userId === viewerUserId,
    createdAt: inbox.createdAt.toISOString(),
    updatedAt: inbox.updatedAt.toISOString(),
  }
}
