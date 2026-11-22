import { z } from "zod";
import { applyEvent, proposeIdeas, type Actor, type PipelineDeps } from "@/lib/pipeline/service";
import type { ExistingProposal, RecentVideo, ScoutStore } from "./proposals";
import { readSignals } from "./settings";
import { readLearnings } from "./variables";

// ScoutStore branché sur PostgreSQL. Les dépendances sont lues à chaque appel : rien n'ouvre la base à l'import.

export const SCOUT_AGENT_ID = 2;
export const SCOUT_ACTOR: Actor = { kind: "agent", agentId: SCOUT_AGENT_ID };

const ideaRefSchema = z.object({
  id: z.string().optional(),
  veille: z.object({ jobId: z.string() }).optional(),
});

function readIdeaRef(ideaJson: unknown): { ideaId: string | null; jobId: string | null } {
  const parsed = ideaRefSchema.safeParse(ideaJson);
  if (!parsed.success) return { ideaId: null, jobId: null };
  return { ideaId: parsed.data.id ?? null, jobId: parsed.data.veille?.jobId ?? null };
}

/** Filtre Prisma : les vidéos créées par une exécution donnée de la veille. */
export function ideasOfJobFilter(jobId: string) {
  return { path: ["veille", "jobId"], equals: jobId };
}

export function createPrismaScoutStore(getDeps: () => PipelineDeps): ScoutStore {
  return {
    async loadSignals() {
      const agent = await getDeps().db.agent.findUnique({ where: { id: SCOUT_AGENT_ID }, select: { settings: true } });
      return readSignals(agent?.settings).text;
    },
    async loadLearnings(channelId) {
      const report = await getDeps().db.analystReport.findFirst({ where: { channelId }, orderBy: { createdAt: "desc" }, select: { content: true } });
      return report ? readLearnings(report.content) : [];
    },
    async listRecentVideos(channelId, since): Promise<RecentVideo[]> {
      const videos = await getDeps().db.video.findMany({
        where: { channelId, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { title: true, ideaJson: true },
      });
      return videos.map((video) => ({ title: video.title, scoutJobId: readIdeaRef(video.ideaJson).jobId }));
    },
    async listProposalsOfJob(channelId, jobId): Promise<ExistingProposal[]> {
      const videos = await getDeps().db.video.findMany({
        where: { channelId, ideaJson: ideasOfJobFilter(jobId) },
        select: { id: true, stage: true, ideaJson: true },
      });
      return videos.map((video) => ({ videoId: video.id, ideaId: readIdeaRef(video.ideaJson).ideaId, stuckInIdea: video.stage === "IDEA" }));
    },
    proposeIdeas(channelId, proposals) {
      return proposeIdeas(getDeps(), channelId, proposals, SCOUT_ACTOR);
    },
    async confirmProposal(videoId) {
      await applyEvent(getDeps(), { videoId, event: "IDEA_PROPOSED", actor: SCOUT_ACTOR }, { notify: false });
    },
    async notifyIdeasWaiting(count) {
      await getDeps().notifier.notify({
        kind: "validation_waiting",
        title: "V1 · Idées à trier",
        message: `${count} idée(s) proposée(s) par le veilleur.`,
        path: "/validations?item=v1",
      });
    },
  };
}
