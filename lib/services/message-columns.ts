import { Prisma } from '@/lib/generated/prisma/client'

/**
 * The `email_messages` columns raw queries project, as an explicit list.
 *
 * This exists because `searchVector` must never be selected (issue #106). It is a
 * tsvector over up to 100k characters of body text — ~220KB per row in practice —
 * so a `SELECT *` on a 50-row page drags roughly 11MB out of Postgres for a column
 * no serializer reads and no caller can use. Postgres has no `SELECT * EXCEPT`, so
 * an explicit list is the only way to exclude it.
 *
 * Keep in sync with the model in prisma/schema.prisma. A column added there and
 * omitted here is invisible to the raw query paths (grouped listing and search)
 * while still appearing on the Prisma-served paths, which is a confusing
 * half-present field rather than a clean failure — so add new columns here too.
 * The serializers stay hand-written allowlists regardless; this list controls what
 * is fetched, not what is published.
 */
export const MESSAGE_COLUMNS = Prisma.sql`
  "id", "from", "to", "bcc", "cc", "subject", "text", "html", "bodyText",
  "headers", "externalId", "inboxEmailAddressId", "organizationId", "threadId",
  "parentMessageId", "messageId", "inReplyTo", "references", "tags", "isStarred",
  "isRead", "categories", "extractedOtp", "metadata", "dispatchedAt", "enrichedAt",
  "deletedAt", "createdAt", "updatedAt"
`
