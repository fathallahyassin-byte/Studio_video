import type { AgentId } from "@/agents/_shared/types";
import { Prisma, type Decision, type Gate, type PrismaClient, type Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import type { Notification, Notifier } from "@/lib/providers/notify";
import { HUMAN_STAGES, STAGE_AGENTS, STAGE_RENDER, stageLabels, transition, type PipelineEvent, type V3ReturnStage } from "./machine";

// Applique la machine à états en base. Chaque changement d'étape écrit, dans UNE transaction :
// la nouvelle étape (si la vidéo n'a pas bougé entre-temps), le journal, la Validation éventuelle
// et les tâches des agents à lancer. Les notifications partent après la transaction.

export type Actor = { kind: "human"; name: string } | { kind: "agent"; agentId: AgentId } | { kind: "system" };

export type PipelineDeps = { db: PrismaClient; notifier: Notifier };

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

const GATE_EVENTS: Partial<Record<PipelineEvent, { gate: Gate; decision: Decision }>> = {
  V1_APPROVED: { gate: "V1", decision: "APPROVED" },
  V1_REJECTED: { gate: "V1", decision: "REJECTED" },
  V2_APPROVED: { gate: "V2", decision: "APPROVED" },
  V2_CHANGES_REQUESTED: { gate: "V2", decision: "CHANGES_REQUESTED" },
  V3_APPROVED: { gate: "V3", decision: "APPROVED" },
  V3_CHANGES_REQUESTED: { gate: "V3", decision: "CHANGES_REQUESTED" },
};

export function actorLabel(actor: Actor): string {
  if (actor.kind === "human") return actor.name;
  if (actor.kind === "agent") return `agent-${actor.agentId}`;
  return "système";
}

export type ApplyEventInput = {
  videoId: string;
  event: PipelineEvent;
  actor: Actor;
  note?: string | null;
  returnTo?: V3ReturnStage;
};

export type AppliedTransition = { videoId: string; title: string; from: Stage; to: Stage; transitionId: string };

type Tx = Prisma.TransactionClient;

export async function applyEvent(deps: PipelineDeps, input: ApplyEventInput, options: { notify?: boolean } = {}): Promise<AppliedTransition> {
  const gate = GATE_EVENTS[input.event];
  // Garde-fou : un agent (orchestrateur compris) ne peut jamais rendre une décision V1, V2 ou V3.
  if (gate && input.actor.kind !== "human") throw new TransitionError("Une validation V1, V2 ou V3 ne peut venir que de l'humain.");
  const note = input.note?.trim() || null;

  const applied = await deps.db.$transaction(async (tx) => {
    const video = await tx.video.findUnique({ where: { id: input.videoId }, select: { id: true, channelId: true, title: true, stage: true, blockedAt: true } });
    if (!video) throw new TransitionError("Vidéo introuvable.");
    const hasV3Approval = input.event === "PUBLISHED" ? (await tx.validation.count({ where: { videoId: video.id, gate: "V3", decision: "APPROVED" } })) > 0 : undefined;
    const result = transition({ stage: video.stage, blockedAt: video.blockedAt, event: input.event, returnTo: input.returnTo, hasV3Approval });
    if (!result.ok) throw new TransitionError(result.reason);

    const updated = await tx.video.updateMany({
      where: { id: video.id, stage: video.stage },
      data: { stage: result.to, blockedAt: result.blockedAt, blockedReason: result.to === "NEEDS_FIX" ? note : null, ...staleDeliverables(result.to) },
    });
    if (updated.count !== 1) throw new TransitionError("La vidéo a changé d'étape entre-temps : recharge la page.");

    const label = actorLabel(input.actor);
    const record = await tx.stageTransition.create({ data: { videoId: video.id, from: result.from, to: result.to, event: input.event, actor: label, note } });
    if (gate) await tx.validation.create({ data: { videoId: video.id, gate: gate.gate, decision: gate.decision, note, decidedBy: label } });
    await cancelStaleJobs(tx, video.id, result.to);
    await createStageJobs(tx, { channelId: video.channelId, videoId: video.id, stage: result.to, transitionId: record.id, note });
    return { videoId: video.id, title: video.title, from: result.from, to: result.to, transitionId: record.id };
  });

  if (options.notify !== false) await notifyHumanStage(deps.notifier, applied, note);
  return applied;
}

/**
 * En entrant dans VISUALS_AND_AUDIO (V2, reprise, renvoi V3), les livrables du passage précédent sont effacés :
 * sinon MEDIA_DONE avancerait avec l'ancien storyboard ou l'ancien plan sonore. Ils restent dans les AgentRun.
 */
function staleDeliverables(to: Stage): Pick<Prisma.VideoUpdateManyMutationInput, "storyboardJson" | "audioJson"> {
  return to === "VISUALS_AND_AUDIO" ? { storyboardJson: Prisma.DbNull, audioJson: Prisma.DbNull } : {};
}

/** Les tâches encore en file d'une étape quittée ne doivent plus tourner. */
async function cancelStaleJobs(tx: Tx, videoId: string, newStage: Stage): Promise<void> {
  await tx.agentJob.updateMany({
    where: { videoId, status: "QUEUED", NOT: { stage: newStage } },
    data: { status: "FAILED", lastError: "Annulée : la vidéo a changé d'étape." },
  });
}

/** Une tâche par agent de l'étape (5 et 6 en parallèle), plus le rendu. La clé dépend de la transition : une reprise relance vraiment l'agent. */
async function createStageJobs(tx: Tx, input: { channelId: string; videoId: string; stage: Stage; transitionId: string; note: string | null }): Promise<void> {
  const agentJobs = (STAGE_AGENTS[input.stage] ?? []).map((agentId) => ({
    jobKey: `${input.transitionId}:agent-${agentId}`,
    kind: "AGENT" as const,
    agentId,
  }));
  const renderJobs = STAGE_RENDER.includes(input.stage) ? [{ jobKey: `${input.transitionId}:render`, kind: "RENDER" as const, agentId: null }] : [];
  const jobs = [...agentJobs, ...renderJobs];
  if (jobs.length === 0) return;
  await tx.agentJob.createMany({
    data: jobs.map((job) => ({ ...job, channelId: input.channelId, videoId: input.videoId, stage: input.stage, transitionId: input.transitionId, note: input.note })),
  });
}

async function notifyHumanStage(notifier: Notifier, applied: AppliedTransition, note: string | null): Promise<void> {
  // V1 est notifiée une fois pour tout le lot d'idées (proposeIdeas).
  if (!HUMAN_STAGES.includes(applied.to) || applied.to === "AWAITING_V1") return;
  const notification: Notification =
    applied.to === "NEEDS_FIX"
      ? { kind: "agent_failed", title: `À corriger : ${applied.title}`, message: note ?? `Bloquée à l'étape ${stageLabels[applied.from]}.`, path: `/validations?item=${applied.videoId}` }
      : { kind: "validation_waiting", title: `${applied.to === "AWAITING_V2" ? "V2 · Script" : "V3 · GO final"} à valider`, message: applied.title, path: `/validations?item=${applied.videoId}` };
  await notifier.notify(notification);
}

// ---------------------------------------------------------------------------
// Opérations composées, utilisées par l'interface et par les agents.
// ---------------------------------------------------------------------------

export type ProposedIdea = { title: string; idea: unknown };

/** Agent 2 : une Video par idée, en attente de V1, et une seule notification pour le lot. */
export async function proposeIdeas(deps: PipelineDeps, channelId: string, ideas: readonly ProposedIdea[], actor: Actor): Promise<string[]> {
  const ids: string[] = [];
  for (const proposal of ideas) {
    const video = await deps.db.video.create({ data: { channelId, title: proposal.title, stage: "IDEA", ideaJson: toInputJson(proposal.idea) } });
    await applyEvent(deps, { videoId: video.id, event: "IDEA_PROPOSED", actor }, { notify: false });
    ids.push(video.id);
  }
  if (ids.length > 0) {
    await deps.notifier.notify({ kind: "validation_waiting", title: "V1 · Idées à trier", message: `${ids.length} idée(s) proposée(s) par le veilleur.`, path: "/validations?item=v1" });
  }
  return ids;
}

/** V1 : produire ou écarter les idées cochées. */
export async function decideIdeas(deps: PipelineDeps, input: { videoIds: readonly string[]; approve: boolean; note: string | null; actor: Actor }): Promise<number> {
  for (const videoId of input.videoIds) {
    await applyEvent(deps, { videoId, event: input.approve ? "V1_APPROVED" : "V1_REJECTED", actor: input.actor, note: input.note });
  }
  return input.videoIds.length;
}

/** « Nouvelle vidéo » : une idée de l'humain, validée d'office en V1, qui part en recherche. */
export async function createManualVideo(deps: PipelineDeps, input: { channelId: string; title: string; angle: string; revelation: string; actor: Actor }): Promise<string> {
  const idea = { id: `H-${Date.now().toString(36)}`, angle: input.angle, revelation: input.revelation, source: "humain" };
  const video = await deps.db.video.create({ data: { channelId: input.channelId, title: input.title, stage: "IDEA", ideaJson: toInputJson(idea) } });
  await applyEvent(deps, { videoId: video.id, event: "IDEA_PROPOSED", actor: input.actor }, { notify: false });
  await applyEvent(deps, { videoId: video.id, event: "V1_APPROVED", actor: input.actor, note: "Idée ajoutée à la main" });
  return video.id;
}

/** Semaine ISO, ex. « 2026-W47 » (clé d'idempotence de la veille). */
export function isoWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function requestWeekly(deps: PipelineDeps, input: { channelId: string; now: Date; agentId: AgentId; prefix: string }): Promise<{ queued: boolean; week: string }> {
  const week = isoWeek(input.now);
  try {
    await deps.db.agentJob.create({ data: { jobKey: `${input.prefix}:${input.channelId}:${week}`, kind: "AGENT", agentId: input.agentId, channelId: input.channelId } });
    return { queued: true, week };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { queued: false, week };
    throw error;
  }
}

/** « Lancer la veille » et le planning du lundi : une seule veille (agent 2) par semaine. */
export function requestScout(deps: PipelineDeps, channelId: string, now: Date): Promise<{ queued: boolean; week: string }> {
  return requestWeekly(deps, { channelId, now, agentId: 2, prefix: "scout" });
}

/** Planning du lundi : une seule analyse (agent 10) par semaine. */
export function requestAnalysis(deps: PipelineDeps, channelId: string, now: Date): Promise<{ queued: boolean; week: string }> {
  return requestWeekly(deps, { channelId, now, agentId: 10, prefix: "analyse" });
}

/** Bloque une vidéo (échec d'un agent, angle à changer…). Sans effet si elle est déjà à corriger. */
export async function blockVideo(deps: PipelineDeps, input: { videoId: string; reason: string; actor: Actor }, options: { notify?: boolean } = {}): Promise<void> {
  const video = await deps.db.video.findUnique({ where: { id: input.videoId }, select: { stage: true } });
  if (!video || video.stage === "NEEDS_FIX") return;
  await applyEvent(deps, { videoId: input.videoId, event: "BLOCKED", actor: input.actor, note: input.reason }, options);
}

/**
 * « Relancer l'étape » d'une vidéo à corriger. Pour une vidéo bloquée en recherche, enregistre d'abord
 * les sources données par l'humain (lues par le recherchiste dans {{SOURCES}}).
 */
export async function resumeVideo(
  deps: PipelineDeps,
  input: { videoId: string; actor: Actor; note?: string | null; researchSources?: readonly string[] },
): Promise<AppliedTransition> {
  if (input.researchSources) {
    const video = await deps.db.video.findUnique({ where: { id: input.videoId }, select: { stage: true, blockedAt: true } });
    if (video?.stage === "NEEDS_FIX" && video.blockedAt === "RESEARCH") {
      await deps.db.video.update({ where: { id: input.videoId }, data: { researchSources: [...input.researchSources] } });
    }
  }
  return applyEvent(deps, { videoId: input.videoId, event: "RESUMED", actor: input.actor, note: input.note });
}

/**
 * Pour le onSuccess des agents : fait avancer la vidéo après leur livrable.
 * MEDIA_DONE n'avance qu'une fois le storyboard (agent 5) ET le plan sonore (agent 6) enregistrés.
 */
export async function completeStage(deps: PipelineDeps, input: { videoId: string; event: PipelineEvent; actor: Actor }): Promise<AppliedTransition | { waiting: true }> {
  if (input.event === "MEDIA_DONE") {
    const video = await deps.db.video.findUnique({ where: { id: input.videoId }, select: { storyboardJson: true, audioJson: true } });
    if (!video || video.storyboardJson === null || video.audioJson === null) return { waiting: true };
  }
  return applyEvent(deps, input);
}
