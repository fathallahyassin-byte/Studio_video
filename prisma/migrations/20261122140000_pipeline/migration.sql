-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('AGENT', 'RENDER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "Decision" ADD VALUE 'REJECTED';

-- CreateTable
CREATE TABLE "StageTransition" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "from" "Stage",
    "to" "Stage" NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoId" TEXT,
    "agentId" INTEGER,
    "stage" "Stage",
    "transitionId" TEXT,
    "note" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageTransition_videoId_createdAt_idx" ON "StageTransition"("videoId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentJob_jobKey_key" ON "AgentJob"("jobKey");

-- CreateIndex
CREATE INDEX "AgentJob_status_runAfter_idx" ON "AgentJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "AgentJob_videoId_idx" ON "AgentJob"("videoId");

-- AddForeignKey
ALTER TABLE "StageTransition" ADD CONSTRAINT "StageTransition_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentJob" ADD CONSTRAINT "AgentJob_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "StageTransition"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Ajout manuel : aucune publication sans Validation V3 approuvée (CLAUDE.md §8).
-- Doublé en code (lib/pipeline) ; ce trigger arrête aussi un bug ou une requête directe.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "studio_require_v3_approval"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Validation"
    WHERE "videoId" = NEW."videoId" AND "gate" = 'V3' AND "decision" = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Publication refusée : la vidéo % n''a pas de validation V3 approuvée', NEW."videoId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Publication_requires_v3" BEFORE INSERT OR UPDATE OF "videoId", "status" ON "Publication"
  FOR EACH ROW EXECUTE FUNCTION "studio_require_v3_approval"();
