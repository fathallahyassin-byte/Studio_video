import type { BibleAuthor, PrismaClient } from "@/lib/generated/prisma/client";
import { checkBible } from "./bible";

/**
 * Remet une version existante en service (retour arrière, adoption d'un brouillon de l'agent 1) :
 * seul le pointeur de la chaîne change, aucune BibleVersion n'est modifiée. null si la version
 * n'existe pas ou appartient à une autre chaîne.
 */
export async function activateBibleVersion(db: PrismaClient, input: { channelId: string; versionId: string }): Promise<{ version: number } | null> {
  const version = await db.bibleVersion.findFirst({ where: { id: input.versionId, channelId: input.channelId }, select: { id: true, version: true, content: true } });
  if (!version) return null;
  const check = checkBible(version.content);
  await db.channel.update({
    where: { id: input.channelId },
    data: { activeBibleVersionId: version.id, ...(check.ok ? { niche: check.fields.niche } : {}) },
  });
  return { version: version.version };
}

/** Crée une nouvelle BibleVersion (jamais de modification) et la rend active pour la chaîne. */
export async function createActiveBibleVersion(
  db: PrismaClient,
  input: { channelId: string; content: string; author: BibleAuthor; note: string | null },
): Promise<{ version: number }> {
  return db.$transaction(async (tx) => {
    const last = await tx.bibleVersion.aggregate({ where: { channelId: input.channelId }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const created = await tx.bibleVersion.create({
      data: { channelId: input.channelId, version, content: input.content, author: input.author, note: input.note },
    });
    const check = checkBible(input.content);
    await tx.channel.update({
      where: { id: input.channelId },
      data: { activeBibleVersionId: created.id, ...(check.ok ? { niche: check.fields.niche } : {}) },
    });
    return { version };
  });
}
