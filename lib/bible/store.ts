import type { BibleAuthor, PrismaClient } from "@/lib/generated/prisma/client";
import { checkBible } from "./bible";

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
