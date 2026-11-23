-- AlterTable : horodatage mot à mot des voix générées (agent 6)
ALTER TABLE "Asset" ADD COLUMN     "wordTimings" JSONB,
ADD COLUMN     "timingSource" TEXT;
