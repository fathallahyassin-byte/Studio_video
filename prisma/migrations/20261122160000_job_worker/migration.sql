-- AlterTable
ALTER TABLE "AgentJob" ADD COLUMN "payload" JSONB,
ADD COLUMN "lockedAt" TIMESTAMP(3);
