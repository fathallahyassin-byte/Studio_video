-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "generationKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_generationKey_key" ON "Asset"("generationKey");
