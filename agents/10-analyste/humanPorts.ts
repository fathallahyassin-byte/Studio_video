import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { BibleCreation, HumanPorts } from "./actionsLogic";
import { isUniqueViolation, queueWeeklyAnalysis } from "./ports";

// Écritures déclenchées par l'humain depuis la page de l'analyste (bible, expériences, relance).

class AlreadyAppliedError extends Error {}

/** Préfixe des tâches d'analyse d'une semaine : celle du planning (`analyse:chaîne:semaine`) et ses relances. */
export function weekJobPrefix(channelId: string, week: string): string {
  return `analyse:${channelId}:${week}`;
}

export function createPrismaHumanPorts(db: PrismaClient): HumanPorts {
  return {
    async loadReport(reportId) {
      const report = await db.analystReport.findUnique({ where: { id: reportId }, select: { id: true, channelId: true, period: true, content: true, appliedBibleVersionId: true } });
      if (!report) return null;
      return { id: report.id, channelId: report.channelId, period: report.period, content: report.content, appliedVersion: await versionOf(db, report.appliedBibleVersionId) };
    },
    async loadActiveBible(channelId) {
      const channel = await db.channel.findUnique({ where: { id: channelId }, select: { activeBibleVersion: { select: { id: true, version: true, content: true } } } });
      return channel?.activeBibleVersion ?? null;
    },
    createBibleFromReport: (input) => createBibleFromReport(db, input),
    async startExperiment(experimentId, channelId, now) {
      const updated = await db.experiment.updateMany({ where: { id: experimentId, channelId, status: "PROPOSED" }, data: { status: "RUNNING", startedAt: now } });
      return updated.count === 1;
    },
    async finishExperiment(experimentId, channelId, now) {
      const updated = await db.experiment.updateMany({ where: { id: experimentId, channelId, status: "RUNNING" }, data: { status: "DONE", endedAt: now } });
      return updated.count === 1;
    },
    queueWeeklyAnalysis,
    async loadWeekJob(channelId, week) {
      return db.agentJob.findFirst({
        where: { jobKey: { startsWith: weekJobPrefix(channelId, week) }, agentId: 10 },
        orderBy: { createdAt: "desc" },
        select: { status: true, lastError: true, runAfter: true },
      });
    },
    async queueRerun(channelId, week) {
      const prefix = weekJobPrefix(channelId, week);
      const count = await db.agentJob.count({ where: { jobKey: { startsWith: prefix } } });
      try {
        await db.agentJob.create({ data: { jobKey: `${prefix}:relance-${count}`, kind: "AGENT", agentId: 10, channelId } });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
  };
}

async function versionOf(db: PrismaClient, bibleVersionId: string | null): Promise<number | null> {
  if (bibleVersionId === null) return null;
  const version = await db.bibleVersion.findUnique({ where: { id: bibleVersionId }, select: { version: true } });
  return version?.version ?? null;
}

/**
 * Une transaction : nouvelle BibleVersion (jamais de modification d'une version existante), rapport marqué appliqué
 * seulement s'il ne l'était pas (sinon tout est annulé), puis adoption comme bible active.
 */
async function createBibleFromReport(db: PrismaClient, input: { reportId: string; channelId: string; content: string; note: string }): Promise<BibleCreation> {
  try {
    const version = await db.$transaction(async (tx) => {
      const last = await tx.bibleVersion.aggregate({ where: { channelId: input.channelId }, _max: { version: true } });
      const next = (last._max.version ?? 0) + 1;
      const created = await tx.bibleVersion.create({ data: { channelId: input.channelId, version: next, content: input.content, author: "AGENT_10", note: input.note } });
      const marked = await tx.analystReport.updateMany({ where: { id: input.reportId, appliedBibleVersionId: null }, data: { appliedBibleVersionId: created.id } });
      if (marked.count !== 1) throw new AlreadyAppliedError();
      await tx.channel.update({ where: { id: input.channelId }, data: { activeBibleVersionId: created.id } });
      return next;
    });
    return { status: "created", version };
  } catch (error) {
    if (!(error instanceof AlreadyAppliedError) && !isUniqueViolation(error)) throw error;
    // Deux clics simultanés : l'autre transaction a créé la version (ou un enregistrement concurrent a pris le numéro).
    const report = await db.analystReport.findUnique({ where: { id: input.reportId }, select: { appliedBibleVersionId: true } });
    if (!report?.appliedBibleVersionId) throw error;
    return { status: "already_applied", version: await versionOf(db, report.appliedBibleVersionId) };
  }
}
