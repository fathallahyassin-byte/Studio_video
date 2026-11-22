import { parseAgentId } from "@/agents/_shared/catalog";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { blockVideo } from "@/lib/pipeline/service";
import { silentNotifier } from "@/lib/providers/notify";
import type { AgentRunStore, StoredAttempt } from "./store";

export function createPrismaRunStore(db: PrismaClient): AgentRunStore {
  return {
    async loadAgent(agentId) {
      const agent = await db.agent.findUnique({ where: { id: agentId }, include: { activePromptVersion: true } });
      if (!agent) return null;
      const prompt = agent.activePromptVersion;
      return {
        id: parseAgentId(agent.id),
        slug: agent.slug,
        name: agent.name,
        model: agent.model,
        active: agent.active,
        promptVersion: prompt ? { id: prompt.id, content: prompt.content } : null,
      };
    },

    async loadActiveBible(channelId) {
      const channel = await db.channel.findUnique({ where: { id: channelId }, include: { activeBibleVersion: true } });
      const bible = channel?.activeBibleVersion;
      return bible ? { id: bible.id, content: bible.content } : null;
    },

    async loadBible(bibleVersionId) {
      const bible = await db.bibleVersion.findUnique({ where: { id: bibleVersionId } });
      return bible ? { id: bible.id, content: bible.content } : null;
    },

    async listAttempts(jobKey) {
      const runs = await db.agentRun.findMany({ where: { jobKey }, orderBy: { attempt: "asc" } });
      return runs.map(
        (run): StoredAttempt => ({
          id: run.id,
          attempt: run.attempt,
          status: run.status,
          rawOutput: run.rawOutput,
          error: run.error,
          output: run.output,
          bibleVersionId: run.bibleVersionId,
          successHandledAt: run.successHandledAt,
        }),
      );
    },

    async recordAttempt(record) {
      const { output, input, ...rest } = record;
      return db.$transaction(async (tx) => {
        const run = await tx.agentRun.create({
          data: { ...rest, input: toInputJson(input), output: output === null ? Prisma.DbNull : toInputJson(output) },
          select: { id: true },
        });
        if (record.videoId && record.cost > 0) {
          await tx.video.update({ where: { id: record.videoId }, data: { totalCost: { increment: record.cost } } });
        }
        return run;
      });
    },

    async markSuccessHandled(runId) {
      await db.agentRun.update({ where: { id: runId }, data: { successHandledAt: new Date() } });
    },

    // runAgent a déjà alerté l'humain : la transition ne renvoie pas de seconde notification.
    async markNeedsFix(videoId, reason) {
      await blockVideo({ db, notifier: silentNotifier }, { videoId, reason, actor: { kind: "system" } });
    },
  };
}
