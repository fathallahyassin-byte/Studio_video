import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient, type Stage } from "@/lib/generated/prisma/client";
import { MANUAL_PROVIDER } from "../upload";
import { parseAmount } from "../variables";
import { latestAssets, toStoryboardView, type PlanAsset, type StoryboardRow, type StoryboardView } from "./storyboards";

const RECENT_LIMIT = 12;

export type StoryboardOverview = {
  storyboards: StoryboardView[];
  /** vidéos à l'étape des visuels sans storyboard enregistré */
  inProgress: number;
  unreadable: number;
  /** BUDGET_SECONDES_VIDEO_IA ; null s'il est absent ou invalide */
  budgetS: number | null;
};

export function readPanelBudget(env: Record<string, string | undefined> = process.env): number | null {
  return parseAmount(env.BUDGET_SECONDES_VIDEO_IA);
}

/** Storyboard d'une vidéo, avec ses médias, pour le détail V3 ; null s'il manque ou est illisible. */
export async function loadStoryboardView(db: PrismaClient, videoId: string): Promise<StoryboardView | null> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, number: true, title: true, stage: true, blockedAt: true, blockedReason: true, updatedAt: true, storyboardJson: true },
  });
  if (!video || video.storyboardJson === null) return null;
  const assets = await loadPlanAssets(db, [video.id]);
  return toStoryboardView(toRow(video), latestAssets(assets, video.id), readPanelBudget());
}

type VideoRow = { id: string; number: number; title: string; stage: Stage; blockedAt: Stage | null; blockedReason: string | null; updatedAt: Date; storyboardJson: unknown };

function toRow(video: VideoRow): StoryboardRow {
  return {
    id: video.id,
    label: formatVideoNumber(video.number),
    title: video.title,
    stage: video.stage,
    blockedAt: video.blockedAt,
    blockedReason: video.blockedReason,
    updatedLabel: formatDateTime(video.updatedAt),
    storyboardJson: video.storyboardJson,
  };
}

async function loadPlanAssets(db: PrismaClient, videoIds: string[]): Promise<(PlanAsset & { videoId: string })[]> {
  const assets = await db.asset.findMany({
    where: { videoId: { in: videoIds }, type: { in: ["IMAGE", "VIDEO"] }, planId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { videoId: true, planId: true, type: true, url: true, provider: true },
  });
  return assets.flatMap((asset) =>
    asset.planId !== null && (asset.type === "IMAGE" || asset.type === "VIDEO")
      ? [{ videoId: asset.videoId, planId: asset.planId, kind: asset.type, url: asset.url, manual: asset.provider === MANUAL_PROVIDER }]
      : [],
  );
}

export async function loadStoryboardOverview(db: PrismaClient, channelId: string, budgetS: number | null): Promise<StoryboardOverview> {
  const [videos, inProgress] = await Promise.all([
    db.video.findMany({
      where: { channelId, storyboardJson: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: { id: true, number: true, title: true, stage: true, blockedAt: true, blockedReason: true, updatedAt: true, storyboardJson: true },
    }),
    db.video.count({ where: { channelId, stage: "VISUALS_AND_AUDIO", storyboardJson: { equals: Prisma.DbNull } } }),
  ]);
  const planAssets = await loadPlanAssets(
    db,
    videos.map((video) => video.id),
  );
  const views = videos.map((video) => toStoryboardView(toRow(video), latestAssets(planAssets, video.id), budgetS));
  const storyboards = views.filter((view): view is StoryboardView => view !== null);
  return { storyboards, inProgress, budgetS, unreadable: views.length - storyboards.length };
}
