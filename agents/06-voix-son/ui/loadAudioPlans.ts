import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import type { TrackJson } from "../audioPlan";
import { MANUAL_PROVIDER, manualTitle } from "../ports";
import { toAudioView, type AudioView } from "./audioPlans";

const RECENT_LIMIT = 12;

export type AudioOverview = {
  plans: AudioView[];
  /** vidéos à l'étape visuels et son sans plan sonore ni sortie de l'agent 6 */
  inProgress: number;
  unreadable: number;
};

function toManualTrack(asset: { url: string; provider: string; license: string | null } | undefined): TrackJson | null {
  if (!asset?.license?.trim()) return null;
  return { titre: manualTitle(asset.provider, asset.url), url: asset.url, fournisseur: MANUAL_PROVIDER, licence: asset.license.trim(), source: "manuel" };
}

export async function loadAudioOverview(db: PrismaClient, channelId: string): Promise<AudioOverview> {
  const hasAgentRun: Prisma.VideoWhereInput = { runs: { some: { agentId: 6, status: "OK" } } };
  const [videos, inProgress] = await Promise.all([
    db.video.findMany({
      where: { channelId, OR: [{ audioJson: { not: Prisma.DbNull } }, hasAgentRun] },
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        number: true,
        title: true,
        stage: true,
        blockedAt: true,
        blockedReason: true,
        updatedAt: true,
        audioJson: true,
        runs: { where: { agentId: 6, status: "OK" }, orderBy: { createdAt: "desc" }, take: 1, select: { output: true } },
        assets: { where: { type: "MUSIC", provider: { startsWith: MANUAL_PROVIDER } }, orderBy: { createdAt: "desc" }, take: 1, select: { url: true, provider: true, license: true } },
      },
    }),
    db.video.count({ where: { channelId, stage: "VISUALS_AND_AUDIO", audioJson: { equals: Prisma.DbNull }, NOT: hasAgentRun } }),
  ]);
  const views = videos.map((video) =>
    toAudioView({
      id: video.id,
      label: formatVideoNumber(video.number),
      title: video.title,
      stage: video.stage,
      blockedAt: video.blockedAt,
      blockedReason: video.blockedReason,
      updatedLabel: formatDateTime(video.updatedAt),
      audioJson: video.audioJson,
      latestOutput: video.runs[0]?.output ?? null,
      manualTrack: toManualTrack(video.assets[0]),
    }),
  );
  const plans = views.filter((view): view is AudioView => view !== null);
  return { plans, inProgress, unreadable: views.length - plans.length };
}
