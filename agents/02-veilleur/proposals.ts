import type { Output } from "./schema";
import type { Idea } from "./rules";
import { findSimilarTitle } from "./similarity";
import type { Learning } from "./variables";

// Après la sortie : une Video par idée, en attente de V1. Rejouable sans doublon après un crash.

export const BACKLOG_DAYS = 90;
/** même limite que le titre d'une « Nouvelle vidéo » */
export const IDEA_TITLE_MAX = 200;

/** ideaJson d'une vidéo créée par le veilleur : l'idée, plus de quoi la retrouver et le signal de similarité. */
export type StoredIdea = Idea & {
  veille: { semaine: string; jobId: string };
  /** titre existant jugé trop proche, ou null */
  proche_de: string | null;
};

export type Proposal = { title: string; idea: StoredIdea };

/** Vidéo déjà créée par une exécution de la veille. */
export type ExistingProposal = { videoId: string; ideaId: string | null; stuckInIdea: boolean };

export type RecentVideo = { title: string; scoutJobId: string | null };

/** Accès à la base du veilleur ; remplacé par un faux dans les tests. */
export type ScoutStore = {
  loadSignals(): Promise<string>;
  loadLearnings(channelId: string): Promise<Learning[]>;
  listRecentVideos(channelId: string, since: Date): Promise<RecentVideo[]>;
  listProposalsOfJob(channelId: string, jobId: string): Promise<ExistingProposal[]>;
  /** proposeIdeas de lib/pipeline : crée les vidéos en AWAITING_V1 et envoie une seule notification */
  proposeIdeas(channelId: string, proposals: readonly Proposal[]): Promise<string[]>;
  /** fait passer en AWAITING_V1 une vidéo restée en IDEA (crash entre sa création et sa transition) */
  confirmProposal(videoId: string): Promise<void>;
  notifyIdeasWaiting(count: number): Promise<void>;
};

export function backlogSince(now: Date): Date {
  return new Date(now.getTime() - BACKLOG_DAYS * 24 * 60 * 60 * 1000);
}

/** Titres du backlog, sans les vidéos de la veille en cours. */
export function backlogTitles(videos: readonly RecentVideo[], jobId: string): string[] {
  return videos.filter((video) => video.scoutJobId !== jobId).map((video) => video.title);
}

export function ideaTitle(idea: Idea): string {
  const title = idea.angle.trim();
  return title.length <= IDEA_TITLE_MAX ? title : `${title.slice(0, IDEA_TITLE_MAX - 1).trimEnd()}…`;
}

export function toProposal(idea: Idea, source: { week: string; jobId: string; backlog: readonly string[] }): Proposal {
  return {
    title: ideaTitle(idea),
    idea: { ...idea, veille: { semaine: source.week, jobId: source.jobId }, proche_de: findSimilarTitle(idea.angle, source.backlog) },
  };
}

/** Idées encore à créer (absentes des vidéos de cette exécution) et vidéos restées en IDEA. */
export function planProposals(output: Output, existing: readonly ExistingProposal[], source: { jobId: string; backlog: readonly string[] }) {
  const done = new Set(existing.map((proposal) => proposal.ideaId));
  return {
    toCreate: output.idees.filter((idea) => !done.has(idea.id)).map((idea) => toProposal(idea, { ...source, week: output.semaine })),
    toConfirm: existing.filter((proposal) => proposal.stuckInIdea).map((proposal) => proposal.videoId),
  };
}

/** onSuccess du veilleur : idempotent, il ne recrée jamais une idée déjà enregistrée pour cette exécution. */
export async function saveScoutIdeas(store: ScoutStore, output: Output, job: { channelId: string; jobId: string }, now: Date): Promise<{ created: number; confirmed: number }> {
  const [existing, recent] = await Promise.all([
    store.listProposalsOfJob(job.channelId, job.jobId),
    store.listRecentVideos(job.channelId, backlogSince(now)),
  ]);
  const plan = planProposals(output, existing, { jobId: job.jobId, backlog: backlogTitles(recent, job.jobId) });
  for (const videoId of plan.toConfirm) await store.confirmProposal(videoId);
  if (plan.toCreate.length > 0) await store.proposeIdeas(job.channelId, plan.toCreate);
  else if (plan.toConfirm.length > 0) await store.notifyIdeasWaiting(existing.length);
  return { created: plan.toCreate.length, confirmed: plan.toConfirm.length };
}
