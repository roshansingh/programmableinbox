-- CreateTable
CREATE TABLE "plans" (
    "id" SMALLSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limits" JSONB NOT NULL,
    "stripePriceId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" SMALLINT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_externalId_key" ON "subscriptions"("externalId");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE INDEX "usage_counters_organizationId_periodStart_idx" ON "usage_counters"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_organizationId_metric_periodStart_key" ON "usage_counters"("organizationId", "metric", "periodStart");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the plans (issue #117 §4).
--
-- `limits` is stored SPARSE: only the keys that differ from unlimited are
-- present, and PlanLimitsSchema (lib/commercial/plan-limits.ts) fills the rest
-- from its permissive defaults on read. That is what lets a future limit be
-- added to the schema without re-seeding every row — and it makes a plan row
-- readable as "here is what this plan actually restricts".
--
-- `null` means unlimited; `Infinity` does not survive JSON. Omitting a key is
-- therefore the same as unlimited, never the same as zero.
--
-- ON CONFLICT DO NOTHING keeps this idempotent, so a re-run (or a deployment
-- that already seeded) is a no-op rather than a duplicate-key failure. Ids come
-- from the SMALLSERIAL sequence and are deliberately not specified — nothing in
-- the application references a Plan.id.
--
-- These rows are inert unless USE_COMMERCIAL=true: the OSS resolver returns
-- unlimited limits without ever reading this table.
INSERT INTO "plans" ("code", "name", "limits", "isPublic", "updatedAt") VALUES
  (
    'self_hosted',
    'Self-hosted',
    -- Empty object: every limit takes its unlimited default.
    '{}'::jsonb,
    -- Not selectable on the hosted offering.
    false,
    CURRENT_TIMESTAMP
  ),
  (
    'free',
    'Free',
    -- 1 inbox, 1,000 inbound emails per period, no outbound email of any kind
    -- (manual send, forward_email and auto_reply all gate on outboundEmail),
    -- no LLM enrichment. `drop` discards inbound mail past the cap: nothing is
    -- persisted and it cannot be recovered by upgrading.
    '{"emailInboxes":1,"incomingEmailsPerPeriod":1000,"outboundEmail":false,"llmEnrichment":false,"phoneInboxesEnabled":false,"overQuotaBehavior":"drop"}'::jsonb,
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'pro',
    'Pro',
    -- 2 inboxes, 5,000 inbound emails per period, outbound email and LLM
    -- enrichment both on.
    --
    -- `drop` rather than `overage` while billing does not exist: overage on a
    -- paid plan is currently *unbilled*, so it would be uncapped LLM and
    -- storage spend against a fixed fee. Flipping to `overage` once Stripe
    -- lands is a one-field UPDATE with no migration.
    '{"emailInboxes":2,"incomingEmailsPerPeriod":5000,"phoneInboxesEnabled":false,"overQuotaBehavior":"drop"}'::jsonb,
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO NOTHING;

