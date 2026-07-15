-- Flat + single-thread keyset pagination: WHERE inboxEmailAddressId ORDER BY createdAt, id
CREATE INDEX "email_messages_inboxEmailAddressId_createdAt_id_idx"
  ON "email_messages" ("inboxEmailAddressId", "createdAt", "id");

-- Grouped thread-list: DISTINCT ON (threadId) heads scan
CREATE INDEX "email_messages_inboxEmailAddressId_threadId_createdAt_id_idx"
  ON "email_messages" ("inboxEmailAddressId", "threadId", "createdAt", "id");

-- Now redundant: leftmost prefix of the new composite above
DROP INDEX "email_messages_inboxEmailAddressId_idx";
