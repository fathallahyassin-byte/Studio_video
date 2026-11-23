import { formatDateTime } from "@/lib/dashboard/format";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { AGENT_ID, findDraftForJob } from "../ports";
import { parseStoredStrategy, toBibleDraftView, toFormDefaults, toJobStatus, toStrategyView, type BibleDraftView, type FormDefaults, type JobStatusView, type StrategyView } from "./view";

// Lecture en base pour le panneau : dernière analyse réussie, son brouillon, la bible active et la dernière tâche.

export type StrategyResult = { view: StrategyView; bible: BibleDraftView; createdLabel: string };

export type StrategyPageData = {
  defaults: FormDefaults;
  job: JobStatusView | null;
  result: StrategyResult | null;
  /** une sortie enregistrée ne respecte plus le schéma (prompt modifié depuis) */
  unreadable: boolean;
};

async function loadLatestRun(db: PrismaClient, channelId: string) {
  return db.agentRun.findFirst({
    where: { channelId, agentId: AGENT_ID, status: "OK" },
    orderBy: { createdAt: "desc" },
    select: { jobKey: true, output: true, createdAt: true },
  });
}

async function loadLatestJob(db: PrismaClient, channelId: string) {
  return db.agentJob.findFirst({
    where: { channelId, agentId: AGENT_ID },
    orderBy: { createdAt: "desc" },
    select: { id: true, jobKey: true, status: true, lastError: true, payload: true },
  });
}

async function loadActiveBible(db: PrismaClient, channelId: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId }, select: { activeBibleVersion: { select: { id: true, version: true, content: true } } } });
  return channel?.activeBibleVersion ?? null;
}

/** Le brouillon porte l'id de la tâche dans sa note ; la tâche se retrouve par la clé de l'AgentRun. */
async function loadDraft(db: PrismaClient, channelId: string, jobKey: string) {
  const job = await db.agentJob.findUnique({ where: { jobKey }, select: { id: true } });
  return job ? findDraftForJob(db, channelId, job.id) : null;
}

export async function loadStrategyPage(db: PrismaClient, channelId: string): Promise<StrategyPageData> {
  const [run, job, active] = await Promise.all([loadLatestRun(db, channelId), loadLatestJob(db, channelId), loadActiveBible(db, channelId)]);
  const output = run ? parseStoredStrategy(run.output) : null;
  const base = { defaults: toFormDefaults(job?.payload ?? null), job: toJobStatus(job, run?.jobKey ?? null), unreadable: run !== null && output === null };
  if (!run || !output) return { ...base, result: null };

  const draft = await loadDraft(db, channelId, run.jobKey);
  return {
    ...base,
    result: { view: toStrategyView(output), bible: toBibleDraftView({ proposed: output.bible, draft, active }), createdLabel: formatDateTime(run.createdAt) },
  };
}
