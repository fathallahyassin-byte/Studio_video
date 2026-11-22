import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { parseAmount } from "../variables";
import { latestAssets, toStoryboardView, type StoryboardView } from "./storyboards";

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
  const assets = await db.asset.findMany({
    where: { videoId: { in: videos.map((video) => video.id) }, type: { in: ["IMAGE", "VIDEO"] }, planId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { videoId: true, planId: true, type: true, url: true },
  });
  const planAssets = assets.flatMap((asset) =>
    asset.planId !== null && (asset.type === "IMAGE" || asset.type === "VIDEO") ? [{ videoId: asset.videoId, planId: asset.planId, kind: asset.type, url: asset.url }] : [],
  );
  const views = videos.map((video) =>
    toStoryboardView(
      {
        id: video.id,
        label: formatVideoNumber(video.number),
        title: video.title,
        stage: video.stage,
        blockedAt: video.blockedAt,
        blockedReason: video.blockedReason,
        updatedLabel: formatDateTime(video.updatedAt),
        storyboardJson: video.storyboardJson,
      },
      latestAssets(planAssets, video.id),
      budgetS,
    ),
  );
  const storyboards = views.filter((view): view is StoryboardView => view !== null);
  return { storyboards, inProgress, budgetS, unreadable: views.length - storyboards.length };
}
