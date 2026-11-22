import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { toDossierView, type DossierView } from "./dossiers";

const RECENT_LIMIT = 30;

export type DossierOverview = {
  dossiers: DossierView[];
  /** vidéos en cours de recherche, sans dossier pour l'instant */
  researching: number;
  unreadable: number;
};

export async function loadDossierOverview(db: PrismaClient, channelId: string): Promise<DossierOverview> {
  const [videos, researching] = await Promise.all([
    db.video.findMany({
      where: { channelId, dossierJson: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: { id: true, number: true, title: true, stage: true, blockedAt: true, updatedAt: true, dossierJson: true },
    }),
    db.video.count({ where: { channelId, stage: "RESEARCH" } }),
  ]);
  const views = videos.map((video) =>
    toDossierView({
      id: video.id,
      label: formatVideoNumber(video.number),
      title: video.title,
      stage: video.stage,
      blockedAt: video.blockedAt,
      updatedLabel: formatDateTime(video.updatedAt),
      dossierJson: video.dossierJson,
    }),
  );
  const dossiers = views.filter((view): view is DossierView => view !== null);
  return { dossiers, researching, unreadable: views.length - dossiers.length };
}
