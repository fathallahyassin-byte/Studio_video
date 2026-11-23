import { z } from "zod";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { isoWeek } from "@/lib/pipeline/service";
import { createPrismaHumanPorts } from "../humanPorts";
import type { PanelInput, VideoRef } from "./view";

// Lecture en base pour le panneau : dernier rapport, expériences, tâche d'analyse de la semaine, vidéos citées.

const rankedSchema = z.array(z.looseObject({ video_id: z.string() }));
const rankingSchema = z.looseObject({ top: rankedSchema.optional(), flop: rankedSchema.optional() });

export async function loadPanelInput(db: PrismaClient, channelId: string, now: Date): Promise<PanelInput> {
  const ports = createPrismaHumanPorts(db);
  const [latest, job, bible] = await Promise.all([
    db.analystReport.findFirst({ where: { channelId }, orderBy: { createdAt: "desc" }, select: { id: true, period: true, createdAt: true, content: true, appliedBibleVersionId: true } }),
    ports.loadWeekJob(channelId, isoWeek(now)),
    ports.loadActiveBible(channelId),
  ]);
  const experiments = await db.experiment.findMany({
    where: { channelId, OR: [{ status: "RUNNING" }, ...(latest ? [{ reportId: latest.id }] : [])] },
    orderBy: { createdAt: "asc" },
    select: { id: true, reportId: true, hypothesis: true, variable: true, successCriterion: true, status: true, startedAt: true },
  });
  const appliedVersion = latest?.appliedBibleVersionId
    ? ((await db.bibleVersion.findUnique({ where: { id: latest.appliedBibleVersionId }, select: { version: true } }))?.version ?? null)
    : null;
  return {
    report: latest ? { id: latest.id, period: latest.period, createdAt: latest.createdAt, content: latest.content, appliedVersion } : null,
    videos: latest ? await loadVideos(db, citedVideoIds(latest.content)) : [],
    experiments,
    job,
    hasActiveBible: bible !== null,
  };
}

/** video_id du top et du flop, lus sans supposer que le contenu est valide. */
export function citedVideoIds(content: unknown): string[] {
  const parsed = rankingSchema.safeParse(content);
  if (!parsed.success) return [];
  return [...new Set([...(parsed.data.top ?? []), ...(parsed.data.flop ?? [])].map((entry) => entry.video_id))];
}

async function loadVideos(db: PrismaClient, ids: string[]): Promise<VideoRef[]> {
  if (ids.length === 0) return [];
  return db.video.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, title: true } });
}
