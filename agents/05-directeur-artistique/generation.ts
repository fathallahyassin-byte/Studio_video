import { createHash } from "node:crypto";
import type { ImageGenProvider, ImageGenRequest } from "@/lib/providers/imageGen";
import type { GeneratedMedia } from "@/lib/providers/media";
import type { VideoGenProvider, VideoGenRequest } from "@/lib/providers/videoGen";
import { planDuration, roundTenth, type Plan } from "./rules";

// Génération des médias plan par plan, via les interfaces de lib/providers. Idempotente : chaque
// génération a une clé (vidéo, plan, tentative, empreinte de la requête) ; une clé déjà réussie n'est jamais relancée.

export type VisualTools = { image: ImageGenProvider | null; video: VideoGenProvider | null };

export type MediaKind = "IMAGE" | "VIDEO";

export type GenerationRecord = {
  key: string;
  videoId: string;
  planId: string;
  attempt: number;
  kind: MediaKind;
  provider: string;
  durationS: number | null;
  media: GeneratedMedia;
};

/** Médias générés : Asset + coût ajouté à la vidéo (branché par la session principale, voir NEEDS.md). */
export type MediaPorts = {
  tools: VisualTools;
  /** génération déjà réussie pour cette clé, null sinon */
  findGeneration(key: string): Promise<{ url: string } | null>;
  /** nombre de générations déjà enregistrées pour ce plan (tentatives précédentes) */
  countGenerations(videoId: string, planId: string): Promise<number>;
  /** enregistre l'Asset et ajoute media.cost à Video.totalCost */
  recordGeneration(record: GenerationRecord): Promise<void>;
};

export type GenerationJob =
  | { kind: "IMAGE"; plan: Plan; key: string; provider: ImageGenProvider; request: ImageGenRequest }
  | { kind: "VIDEO"; plan: Plan; key: string; provider: VideoGenProvider; request: VideoGenRequest };

export type JobsResult = { ok: true; jobs: GenerationJob[] } | { ok: false; missing: string[] };

/** Empreinte courte de la requête : un storyboard refait (prompt différent) ne réutilise pas l'ancien média. */
export function fingerprint(request: ImageGenRequest | VideoGenRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 12);
}

export function generationKey(videoId: string, planId: string, attempt: number, request: ImageGenRequest | VideoGenRequest): string {
  return `${videoId}:${planId}:${attempt}:${fingerprint(request)}`;
}

/** Une génération par plan image_ia_animee (image) ou video_ia (vidéo) ; texte animé et stock n'en ont pas. */
export function buildJobs(videoId: string, plans: readonly Plan[], tools: VisualTools, attemptOf: (planId: string) => number = () => 1): JobsResult {
  const jobs: GenerationJob[] = [];
  const missing: string[] = [];
  for (const plan of plans) {
    const job = buildJob(videoId, plan, tools, attemptOf(plan.id));
    if (job === "missing") missing.push(plan.id);
    else if (job) jobs.push(job);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, jobs };
}

function buildJob(videoId: string, plan: Plan, tools: VisualTools, attempt: number): GenerationJob | "missing" | null {
  const prompt = plan.prompt_en?.trim() ?? "";
  if (plan.type === "image_ia_animee") {
    if (!tools.image || prompt === "") return "missing";
    const request: ImageGenRequest = { prompt, negativePrompt: plan.negative_prompt_en, aspectRatio: "9:16" };
    return { kind: "IMAGE", plan, provider: tools.image, request, key: generationKey(videoId, plan.id, attempt, request) };
  }
  if (plan.type === "video_ia") {
    if (!tools.video || prompt === "") return "missing";
    const request: VideoGenRequest = { prompt, negativePrompt: plan.negative_prompt_en, durationS: roundTenth(planDuration(plan)), aspectRatio: "9:16" };
    return { kind: "VIDEO", plan, provider: tools.video, request, key: generationKey(videoId, plan.id, attempt, request) };
  }
  return null;
}

export function estimateJob(job: GenerationJob): number {
  return job.kind === "IMAGE" ? job.provider.estimateCost(job.request) : job.provider.estimateCost(job.request);
}

async function runJob(job: GenerationJob): Promise<GeneratedMedia> {
  return job.kind === "IMAGE" ? job.provider.generate(job.request) : job.provider.generate(job.request);
}

export type GenerationOutcome =
  | { status: "done"; generated: number; reused: number; cost: number }
  | { status: "missing_tool"; planIds: string[] }
  | { status: "no_budget" }
  | { status: "over_budget"; estimate: number; remaining: number }
  | { status: "stopped"; generated: number };

export type GenerationRequest = {
  videoId: string;
  plans: readonly Plan[];
  /** BUDGET_PAR_VIDEO moins ce que la vidéo a déjà coûté ; null si le budget n'est pas configuré */
  remainingBudget: number | null;
  /** relu avant chaque génération payante : faux si la vidéo a quitté l'étape (abandon, blocage) */
  isStillActive(): Promise<boolean>;
  attemptOf?: (planId: string) => number;
};

/**
 * Estime le coût de ce qui reste à générer, refuse au-delà du budget (CLAUDE.md §5.7), puis génère
 * plan par plan. Rejouée après un crash, elle saute les générations déjà enregistrées.
 */
export async function generateMedia(media: MediaPorts, request: GenerationRequest): Promise<GenerationOutcome> {
  const built = buildJobs(request.videoId, request.plans, media.tools, request.attemptOf);
  if (!built.ok) return { status: "missing_tool", planIds: built.missing };
  const pending = await pendingJobs(media, built.jobs);
  const reused = built.jobs.length - pending.length;
  if (pending.length === 0) return { status: "done", generated: 0, reused, cost: 0 };

  const estimate = pending.reduce((total, job) => total + estimateJob(job), 0);
  if (request.remainingBudget === null) return { status: "no_budget" };
  if (estimate > request.remainingBudget) return { status: "over_budget", estimate, remaining: request.remainingBudget };

  let cost = 0;
  for (const [index, job] of pending.entries()) {
    if (!(await request.isStillActive())) return { status: "stopped", generated: index };
    cost += await generateOne(media, request.videoId, job, request.attemptOf?.(job.plan.id) ?? 1);
  }
  return { status: "done", generated: pending.length, reused, cost };
}

async function pendingJobs(media: MediaPorts, jobs: readonly GenerationJob[]): Promise<GenerationJob[]> {
  const pending: GenerationJob[] = [];
  for (const job of jobs) {
    if ((await media.findGeneration(job.key)) === null) pending.push(job);
  }
  return pending;
}

async function generateOne(media: MediaPorts, videoId: string, job: GenerationJob, attempt: number): Promise<number> {
  const result = await runJob(job);
  await media.recordGeneration({
    key: job.key,
    videoId,
    planId: job.plan.id,
    attempt,
    kind: job.kind,
    provider: job.provider.name,
    durationS: job.kind === "VIDEO" ? job.request.durationS : null,
    media: result,
  });
  return result.cost;
}

export function formatMoneyAmount(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2).replace(".", ",")} €`;
}

/** Raison affichée à l'humain (blocage de la vidéo) ; null si la génération s'est bien passée. */
export function outcomeBlockReason(outcome: GenerationOutcome): string | null {
  switch (outcome.status) {
    case "missing_tool":
      return `Directeur artistique : aucun générateur disponible pour les plans ${outcome.planIds.join(", ")}. Branche un fournisseur ou relance l'étape.`;
    case "no_budget":
      return "Directeur artistique : BUDGET_PAR_VIDEO est absent ou invalide dans .env : génération payante refusée.";
    case "over_budget":
      return `Directeur artistique : génération estimée à ${formatMoneyAmount(outcome.estimate)}, il reste ${formatMoneyAmount(outcome.remaining)} sur le budget de la vidéo. Rien n'a été généré.`;
    default:
      return null;
  }
}
