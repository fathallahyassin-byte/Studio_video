import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { toReportView, type ReportView } from "./reports";

const RECENT_LIMIT = 20;

export type ReportOverview = {
  reports: ReportView[];
  /** vidéos en contrôle sans rapport enregistré */
  checking: number;
  unreadable: number;
};

export async function loadReportOverview(db: PrismaClient, channelId: string): Promise<ReportOverview> {
  const [videos, checking] = await Promise.all([
    db.video.findMany({
      where: { channelId, qaJson: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        number: true,
        title: true,
        stage: true,
        blockedAt: true,
        updatedAt: true,
        qaJson: true,
        assets: { where: { type: "RENDER" }, orderBy: { createdAt: "desc" }, take: 1, select: { url: true } },
      },
    }),
    db.video.count({ where: { channelId, stage: "QA", qaJson: { equals: Prisma.DbNull } } }),
  ]);
  const views = videos.map((video) =>
    toReportView({
      id: video.id,
      label: formatVideoNumber(video.number),
      title: video.title,
      stage: video.stage,
      blockedAt: video.blockedAt,
      updatedLabel: formatDateTime(video.updatedAt),
      qaJson: video.qaJson,
      renderUrl: video.assets[0]?.url ?? null,
    }),
  );
  const reports = views.filter((view): view is ReportView => view !== null);
  return { reports, checking, unreadable: views.length - reports.length };
}
