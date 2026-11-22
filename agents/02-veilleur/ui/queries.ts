import { z } from "zod";
import type { JobStatus, PrismaClient, Stage } from "@/lib/generated/prisma/client";
import { ideasOfJobFilter, SCOUT_AGENT_ID } from "../prismaStore";
import type { Idea } from "../rules";
import { outputSchema, type Output } from "../schema";
import { readSignals, type ScoutSignals } from "../settings";

// Données du panneau : signaux, dernière tâche de veille et dernière veille réussie avec ses vidéos.

export type ScoutIdeaRow = Idea & {
  video: { id: string; number: number; stage: Stage } | null;
  procheDe: string | null;
};

export type LastScout = {
  week: string;
  createdAt: Date;
  ideas: ScoutIdeaRow[];
  series: Output["series"];
  discarded: Output["ecartees"];
};

export type ScoutJobState = { status: JobStatus; jobKey: string; lastError: string | null; createdAt: Date };

export type ScoutPanelData = { signals: ScoutSignals; lastJob: ScoutJobState | null; lastScout: LastScout | null };

const storedIdeaSchema = z.object({ id: z.string(), proche_de: z.string().nullable().optional() });

async function loadVideosOfRun(db: PrismaClient, channelId: string, jobKey: string) {
  const job = await db.agentJob.findUnique({ where: { jobKey }, select: { id: true } });
  if (!job) return new Map<string, { video: ScoutIdeaRow["video"]; procheDe: string | null }>();
  const videos = await db.video.findMany({
    where: { channelId, ideaJson: ideasOfJobFilter(job.id) },
    select: { id: true, number: true, stage: true, ideaJson: true },
  });
  const byIdea = new Map<string, { video: ScoutIdeaRow["video"]; procheDe: string | null }>();
  for (const video of videos) {
    const parsed = storedIdeaSchema.safeParse(video.ideaJson);
    if (parsed.success) byIdea.set(parsed.data.id, { video: { id: video.id, number: video.number, stage: video.stage }, procheDe: parsed.data.proche_de ?? null });
  }
  return byIdea;
}

async function loadLastScout(db: PrismaClient, channelId: string): Promise<LastScout | null> {
  const run = await db.agentRun.findFirst({
    where: { channelId, agentId: SCOUT_AGENT_ID, status: "OK" },
    orderBy: { createdAt: "desc" },
    select: { output: true, createdAt: true, jobKey: true },
  });
  const parsed = outputSchema.safeParse(run?.output);
  if (!run || !parsed.success) return null;
  const videos = await loadVideosOfRun(db, channelId, run.jobKey);
  const ideas = parsed.data.idees
    .map((idea) => ({ ...idea, video: videos.get(idea.id)?.video ?? null, procheDe: videos.get(idea.id)?.procheDe ?? null }))
    .sort((a, b) => b.score - a.score);
  return { week: parsed.data.semaine, createdAt: run.createdAt, ideas, series: parsed.data.series, discarded: parsed.data.ecartees };
}

export async function loadScoutPanel(db: PrismaClient, channelId: string): Promise<ScoutPanelData> {
  const [agent, lastJob, lastScout] = await Promise.all([
    db.agent.findUnique({ where: { id: SCOUT_AGENT_ID }, select: { settings: true } }),
    db.agentJob.findFirst({
      where: { channelId, agentId: SCOUT_AGENT_ID, videoId: null },
      orderBy: { createdAt: "desc" },
      select: { status: true, jobKey: true, lastError: true, createdAt: true },
    }),
    loadLastScout(db, channelId),
  ]);
  return { signals: readSignals(agent?.settings), lastJob, lastScout };
}
