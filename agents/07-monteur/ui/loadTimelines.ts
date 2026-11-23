import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import type { EditAsset } from "../ports";
import type { TimelineView } from "./view";
import { toPendingEdit, toTimelineView, type PendingEditView } from "./timelines";

const RECENT_LIMIT = 12;

export type TimelineOverview = {
  timelines: TimelineView[];
  /** vidéos au montage (ou bloquées au montage) sans timeline : ce qui manque pour lancer l'agent */
  pending: PendingEditView[];
  unreadable: number;
};

async function assetsByVideo(db: PrismaClient, videoIds: readonly string[]): Promise<Map<string, EditAsset[]>> {
  const assets = await db.asset.findMany({
    where: { videoId: { in: [...videoIds] } },
    orderBy: { createdAt: "desc" },
    select: { videoId: true, type: true, url: true, planId: true, durationS: true, license: true },
  });
  const grouped = new Map<string, EditAsset[]>();
  for (const { videoId, ...asset } of assets) grouped.set(videoId, [...(grouped.get(videoId) ?? []), asset]);
  return grouped;
}

/** URL du dernier MP4 rendu (assets triés du plus récent au plus ancien). */
function latestRender(assets: readonly EditAsset[]): string | null {
  return assets.find((asset) => asset.type === "RENDER")?.url ?? null;
}

async function loadTimelines(db: PrismaClient, channelId: string): Promise<{ timelines: TimelineView[]; unreadable: number }> {
  const videos = await db.video.findMany({
    where: { channelId, timelineJson: { not: Prisma.DbNull } },
    orderBy: { updatedAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, number: true, title: true, stage: true, blockedAt: true, blockedReason: true, updatedAt: true, timelineJson: true },
  });
  const assets = await assetsByVideo(db, videos.map((video) => video.id));
  const views = videos.map((video) =>
    toTimelineView({ ...video, label: formatVideoNumber(video.number), updatedLabel: formatDateTime(video.updatedAt) }, latestRender(assets.get(video.id) ?? [])),
  );
  const timelines = views.filter((view): view is TimelineView => view !== null);
  return { timelines, unreadable: views.length - timelines.length };
}

async function loadPending(db: PrismaClient, channelId: string): Promise<PendingEditView[]> {
  const videos = await db.video.findMany({
    where: { channelId, timelineJson: { equals: Prisma.DbNull }, OR: [{ stage: "EDIT" }, { stage: "NEEDS_FIX", blockedAt: "EDIT" }] },
    orderBy: { updatedAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, number: true, title: true, stage: true, blockedAt: true, storyboardJson: true, audioJson: true },
  });
  const assets = await assetsByVideo(db, videos.map((video) => video.id));
  return videos.map((video) =>
    toPendingEdit(
      {
        id: video.id,
        label: formatVideoNumber(video.number),
        title: video.title,
        video: { stage: video.stage, blockedAt: video.blockedAt, storyboard: video.storyboardJson, audio: video.audioJson, timeline: null },
      },
      assets.get(video.id) ?? [],
    ),
  );
}

export async function loadTimelineOverview(db: PrismaClient, channelId: string): Promise<TimelineOverview> {
  const [{ timelines, unreadable }, pending] = await Promise.all([loadTimelines(db, channelId), loadPending(db, channelId)]);
  return { timelines, pending, unreadable };
}
