import type { PrismaClient } from "@/lib/generated/prisma/client";
import { PUBLICATION_AGENT_ID } from "../ports";
import { readKeywords, type PublicationKeywords } from "../settings";
import type { VideoInput } from "./overview";

// Lecture en base du panneau : vidéos programmées et publications récentes de la chaîne, mots-clés de l'agent.

const RECENT_DAYS = 14;
const LIMIT = 30;

export async function loadPublicationVideos(db: PrismaClient, channelId: string, now: Date): Promise<VideoInput[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const videos = await db.video.findMany({
    where: { channelId, OR: [{ stage: "SCHEDULED" }, { stage: "PUBLISHED", updatedAt: { gte: since } }] },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      number: true,
      title: true,
      stage: true,
      publishJson: true,
      qaJson: true,
      _count: { select: { validations: { where: { gate: "V3", decision: "APPROVED" } } } },
      assets: { where: { type: "RENDER" }, orderBy: { createdAt: "desc" }, take: 1, select: { url: true } },
      publications: {
        select: { id: true, platform: true, mode: true, status: true, scheduledFor: true, publishedAt: true, externalId: true, aiLabel: true, brandedContent: true },
      },
    },
  });
  return videos.map(({ _count, assets, ...video }) => ({ ...video, hasV3Approval: _count.validations > 0, renderUrl: assets[0]?.url ?? null }));
}

export async function loadKeywords(db: PrismaClient): Promise<PublicationKeywords> {
  const agent = await db.agent.findUnique({ where: { id: PUBLICATION_AGENT_ID }, select: { settings: true } });
  return readKeywords(agent?.settings);
}
