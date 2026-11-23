-- Brouillon de bible relié à la tâche qui l'a produit (agent 1) : une seule version par tâche.
-- AlterTable
ALTER TABLE "BibleVersion" ADD COLUMN     "sourceJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BibleVersion_sourceJobId_key" ON "BibleVersion"("sourceJobId");

-- Rappels du planning (rappel mensuel du stratège de niche).
-- CreateTable
CREATE TABLE "Reminder" (
    "key" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
