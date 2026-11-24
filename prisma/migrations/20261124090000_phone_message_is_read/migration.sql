-- Read state for the phone inbox UI (issue #143). Inbox-wide, like email's isRead.
ALTER TABLE "phone_messages" ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;
