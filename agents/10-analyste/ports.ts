import { getDb } from "@/lib/db";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { requestAnalysis } from "@/lib/pipeline/service";
import type { VideoRecord } from "./metadata";
import type { Output } from "./schema";
import type { PublicationSample } from "./stats";
import type { RunningExperiment } from "./variables";

// Accès à la base dont l'agent 10 a besoin. Remplacés par des faux dans les tests.

export const ANALYST_AGENT_ID = 10;

export type PeriodData = { samples: PublicationSample[]; videos: VideoRecord[] };

export type NewReport = { channelId: string; agentRunId: string; period: string; content: Output };

export type AnalysisPorts = {
  now(): Date;
  /** publications mises en ligne dans la fenêtre, leur dernier relevé jusqu'à `now`, et leurs vidéos */
  loadPeriod(channelId: string, since: Date, now: Date): Promise<PeriodData>;
  loadRunningExperiments(channelId: string): Promise<RunningExperiment[]>;
  /** AgentRun réussi de la tâche (via sa jobKey) ; null si introuvable */
  findSucceededRunId(jobId: string): Promise<string | null>;
  /** rapport + expériences proposées, en une écriture ; « exists » si le rapport de cet AgentRun existe déjà */
  saveReport(report: NewReport): Promise<"created" | "exists">;
};

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaAnalysisPorts(): AnalysisPorts {
  return {
    now: () => new Date(),
    loadPeriod: (channelId, since, now) => loadPeriod(getDb(), channelId, since, now),
    async loadRunningExperiments(channelId) {
      return getDb().experiment.findMany({
        where: { channelId, status: "RUNNING" },
        orderBy: { startedAt: "asc" },
        select: { hypothesis: true, variable: true, successCriterion: true, startedAt: true },
      });
    },
    async findSucceededRunId(jobId) {
      const job = await getDb().agentJob.findUnique({ where: { id: jobId }, select: { jobKey: true } });
      if (!job) return null;
      const run = await getDb().agentRun.findFirst({ where: { jobKey: job.jobKey, agentId: ANALYST_AGENT_ID, status: "OK" }, select: { id: true } });
      return run?.id ?? null;
    },
    saveReport: (report) => saveReport(getDb(), report),
  };
}

const STAT_FIELDS = { date: true, views: true, avgWatchTimeS: true, completionRate: true, shares: true, saves: true, followersGained: true } as const;

export async function loadPeriod(db: PrismaClient, channelId: string, since: Date, now: Date): Promise<PeriodData> {
  const publications = await db.publication.findMany({
    where: { status: "PUBLISHED", video: { channelId }, publishedAt: { gte: since, lte: now } },
    orderBy: [{ publishedAt: "asc" }, { platform: "asc" }],
    select: {
      videoId: true,
      platform: true,
      publishedAt: true,
      stats: { where: { date: { lte: now } }, orderBy: { date: "desc" }, take: 1, select: STAT_FIELDS },
    },
  });
  const samples = publications.map((publication) => ({
    videoId: publication.videoId,
    platform: publication.platform,
    publishedAt: publication.publishedAt,
    stat: publication.stats[0] ?? null,
  }));
  return { samples, videos: await loadVideos(db, [...new Set(samples.map((sample) => sample.videoId))]) };
}

async function loadVideos(db: PrismaClient, ids: string[]): Promise<VideoRecord[]> {
  const videos = await db.video.findMany({
    where: { id: { in: ids } },
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      title: true,
      ideaJson: true,
      scriptJson: true,
      storyboardJson: true,
      timelineJson: true,
      publications: { where: { status: "PUBLISHED" }, select: { platform: true, publishedAt: true } },
      runs: { where: { status: "OK" }, orderBy: { createdAt: "desc" }, select: { agentId: true, promptVersion: { select: { version: true } } } },
    },
  });
  return videos.map((video) => ({
    id: video.id,
    number: video.number,
    title: video.title,
    idea: video.ideaJson,
    script: video.scriptJson,
    storyboard: video.storyboardJson,
    timeline: video.timelineJson,
    publications: video.publications,
    promptVersions: latestVersionPerAgent(video.runs),
  }));
}

/** Les exécutions arrivent de la plus récente à la plus ancienne : la première de chaque agent est la bonne. */
export function latestVersionPerAgent(runs: readonly { agentId: number; promptVersion: { version: number } }[]): { agentId: number; version: number }[] {
  const seen = new Map<number, number>();
  for (const run of runs) if (!seen.has(run.agentId)) seen.set(run.agentId, run.promptVersion.version);
  return [...seen.entries()].map(([agentId, version]) => ({ agentId, version }));
}

export async function saveReport(db: PrismaClient, report: NewReport): Promise<"created" | "exists"> {
  const existing = await db.analystReport.findUnique({ where: { agentRunId: report.agentRunId }, select: { id: true } });
  if (existing) return "exists";
  try {
    await db.analystReport.create({
      data: {
        channelId: report.channelId,
        agentRunId: report.agentRunId,
        period: report.period,
        content: toInputJson(report.content),
        experiments: {
          create: report.content.experiences.map((experiment) => ({
            channelId: report.channelId,
            hypothesis: experiment.hypothese,
            variable: experiment.variable,
            successCriterion: experiment.critere_reussite,
          })),
        },
      },
    });
    return "created";
  } catch (error) {
    // Deux workers sur la même reprise : le second trouve le rapport déjà écrit.
    if (isUniqueViolation(error)) return "exists";
    throw error;
  }
}

/** « Lancer l'analyse » : la tâche de la semaine (partagée avec le planning du lundi). */
export function queueWeeklyAnalysis(channelId: string, now: Date): Promise<{ queued: boolean; week: string }> {
  return requestAnalysis(getPipelineDeps(), channelId, now);
}
