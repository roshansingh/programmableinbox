-- Stripe Billing (issue #120).

-- CreateEnum
--
-- Narrowed to the four states this app acts on. Stripe also emits `incomplete`,
-- `incomplete_expired`, `unpaid` and `paused`; the webhook maps those onto
-- these rather than widening the enum, so no subscription can reach a state
-- with no decided answer to "is this organization entitled?".
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'past_due', 'canceled');

-- AlterTable
--
-- Converted in place with a USING cast, NOT dropped and re-added.
--
-- `prisma migrate diff` generates DROP COLUMN + ADD COLUMN for this change,
-- which discards every existing status. That is currently harmless only because
-- no deployment has run with USE_COMMERCIAL=true yet — a fact that is true
-- today and silently stops being true the moment one does. The cast preserves
-- the data, and fails loudly if any row holds a value outside the enum, which
-- is the outcome to want: a subscription in an unrecognised state should stop
-- the migration rather than be quietly emptied.
ALTER TABLE "subscriptions"
  ALTER COLUMN "status" TYPE "SubscriptionStatus"
  USING "status"::"SubscriptionStatus";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "stripeCustomerId" TEXT;

-- CreateIndex
--
-- Unique so a double-submitted checkout cannot mint two Stripe customers for
-- one organization, splitting their invoices across two records.
CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON "organizations"("stripeCustomerId");

-- Now that invoicing exists, `pro` bills overage rather than discarding mail.
--
-- #118 seeded it as `drop` deliberately: overage without billing is uncapped
-- LLM and storage spend against a fixed fee. With Stripe wired that reasoning
-- inverts — a paying customer's mail must not stop at the cap. `free` keeps
-- `drop`, which is what bounds cost on the unpaid tier.
UPDATE "plans"
   SET "limits" = jsonb_set("limits", '{overQuotaBehavior}', '"overage"'),
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "code" = 'pro';
