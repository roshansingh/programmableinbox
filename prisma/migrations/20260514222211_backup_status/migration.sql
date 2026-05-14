-- CreateTable
CREATE TABLE "backup_status" (
    "job_name" TEXT NOT NULL,
    "last_success_at" TIMESTAMPTZ NOT NULL,
    "details" JSONB,

    CONSTRAINT "backup_status_pkey" PRIMARY KEY ("job_name")
);
