import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDb } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { getStorageProvider } from "@/lib/providers/s3";
import type { StorageProvider } from "@/lib/providers/storage";
import { createPrismaStoryboardPorts } from "./ports";
import { MANUAL_PROVIDER, type UploadPorts } from "./upload";

// Ports réels de « Ajouter le fichier du plan » : stockage S3 et Asset en base. Séparés de ports.ts
// pour que le registre des agents (importé par le worker) ne charge pas le SDK S3.

export function createPrismaUploadPorts(): UploadPorts {
  const db = getDb();
  const storage = getStorageProvider();
  return {
    loadVideo: (videoId) => createPrismaStoryboardPorts().loadVideo(videoId),
    storeFile: storage ? (request) => storeBytes(storage, request) : null,
    async recordUpload(record) {
      try {
        await db.asset.create({
          data: {
            videoId: record.videoId,
            type: record.kind,
            url: record.url,
            provider: MANUAL_PROVIDER,
            license: record.license,
            planId: record.planId,
            generationKey: record.key,
          },
        });
      } catch (error) {
        // Même fichier déjà envoyé pour ce plan : l'Asset existe, rien à refaire.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
        throw error;
      }
    },
  };
}

/** Le stockage envoie un fichier local : on passe par un fichier temporaire, supprimé ensuite. */
async function storeBytes(storage: StorageProvider, request: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ url: string }> {
  const filePath = path.join(tmpdir(), `studio-plan-${randomUUID()}`);
  await writeFile(filePath, request.bytes);
  try {
    const stored = await storage.putFile({ key: request.key, filePath, contentType: request.contentType });
    return { url: stored.url };
  } finally {
    await rm(filePath, { force: true });
  }
}
