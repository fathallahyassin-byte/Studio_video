-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('IDEA', 'AWAITING_V1', 'RESEARCH', 'SCRIPT', 'AWAITING_V2', 'VISUALS_AND_AUDIO', 'EDIT', 'RENDER', 'QA', 'AWAITING_V3', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'NEEDS_FIX');

-- CreateEnum
CREATE TYPE "BibleAuthor" AS ENUM ('HUMAN', 'AGENT_1', 'AGENT_10');

-- CreateEnum
CREATE TYPE "PromptSource" AS ENUM ('FILE', 'UI');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('OK', 'INVALID_JSON', 'CONTROL_FAILED', 'ERROR');

-- CreateEnum
CREATE TYPE "Gate" AS ENUM ('V1', 'V2', 'V3');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('IMAGE', 'VIDEO', 'VOICE', 'MUSIC', 'RENDER');

-- CreateEnum
CREATE TYPE "PublishMode" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('PROPOSED', 'RUNNING', 'DONE', 'ABANDONED');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "platforms" "Platform"[],
    "activeBibleVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BibleVersion" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "author" "BibleAuthor" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BibleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "activePromptVersionId" TEXT,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "agentId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "source" "PromptSource" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "Stage" NOT NULL DEFAULT 'IDEA',
    "blockedAt" "Stage",
    "blockedReason" TEXT,
    "partnership" TEXT NOT NULL DEFAULT 'aucun',
    "ideaJson" JSONB,
    "dossierJson" JSONB,
    "scriptJson" JSONB,
    "storyboardJson" JSONB,
    "audioJson" JSONB,
    "timelineJson" JSONB,
    "qaJson" JSONB,
    "publishJson" JSONB,
    "totalCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoId" TEXT,
    "agentId" INTEGER NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "bibleVersionId" TEXT,
    "model" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "rawOutput" TEXT,
    "status" "RunStatus" NOT NULL,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "successHandledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Validation" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "gate" "Gate" NOT NULL,
    "decision" "Decision" NOT NULL,
    "note" TEXT,
    "decidedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Validation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "url" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "license" TEXT,
    "planId" TEXT,
    "durationS" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "mode" "PublishMode" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "status" "PublicationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "aiLabel" BOOLEAN NOT NULL,
    "brandedContent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stat" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL,
    "avgWatchTimeS" DOUBLE PRECISION NOT NULL,
    "completionRate" DOUBLE PRECISION NOT NULL,
    "shares" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "followersGained" INTEGER NOT NULL,

    CONSTRAINT "Stat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalystReport" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "appliedBibleVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalystReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "reportId" TEXT,
    "hypothesis" TEXT NOT NULL,
    "variable" TEXT NOT NULL,
    "successCriterion" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'PROPOSED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_activeBibleVersionId_key" ON "Channel"("activeBibleVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "BibleVersion_channelId_version_key" ON "BibleVersion"("channelId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_activePromptVersionId_key" ON "Agent"("activePromptVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_agentId_version_key" ON "PromptVersion"("agentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Video_number_key" ON "Video"("number");

-- CreateIndex
CREATE INDEX "Video_channelId_stage_idx" ON "Video"("channelId", "stage");

-- CreateIndex
CREATE INDEX "AgentRun_videoId_idx" ON "AgentRun"("videoId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_jobKey_attempt_key" ON "AgentRun"("jobKey", "attempt");

-- CreateIndex
CREATE INDEX "Validation_videoId_gate_idx" ON "Validation"("videoId", "gate");

-- CreateIndex
CREATE INDEX "Asset_videoId_type_idx" ON "Asset"("videoId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_videoId_platform_key" ON "Publication"("videoId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Stat_publicationId_date_key" ON "Stat"("publicationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalystReport_agentRunId_key" ON "AnalystReport"("agentRunId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_activeBibleVersionId_fkey" FOREIGN KEY ("activeBibleVersionId") REFERENCES "BibleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibleVersion" ADD CONSTRAINT "BibleVersion_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_activePromptVersionId_fkey" FOREIGN KEY ("activePromptVersionId") REFERENCES "PromptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_bibleVersionId_fkey" FOREIGN KEY ("bibleVersionId") REFERENCES "BibleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stat" ADD CONSTRAINT "Stat_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalystReport" ADD CONSTRAINT "AnalystReport_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalystReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Ajouts manuels : Prisma ne gère ni les CHECK ni les triggers.
-- ---------------------------------------------------------------------------

-- La licence d'un Asset musical est obligatoire (CLAUDE.md §8).
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_music_license_check"
  CHECK ("type" <> 'MUSIC' OR ("license" IS NOT NULL AND btrim("license") <> ''));

-- 3 tentatives au maximum par exécution (CLAUDE.md §5.3).
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_attempt_check" CHECK ("attempt" BETWEEN 1 AND 3);

-- Les agents sont numérotés de 0 à 10.
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_id_check" CHECK ("id" BETWEEN 0 AND 10);

-- Une BibleVersion ou une PromptVersion ne se modifie ni ne se supprime (CLAUDE.md §13).
CREATE FUNCTION "studio_forbid_version_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% est immuable : enregistre une nouvelle version', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BibleVersion_immutable" BEFORE UPDATE OR DELETE ON "BibleVersion"
  FOR EACH ROW EXECUTE FUNCTION "studio_forbid_version_change"();

CREATE TRIGGER "PromptVersion_immutable" BEFORE UPDATE OR DELETE ON "PromptVersion"
  FOR EACH ROW EXECUTE FUNCTION "studio_forbid_version_change"();
