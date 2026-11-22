import type { Stage } from "@/lib/generated/prisma/client";
import { generateMedia, outcomeBlockReason } from "./generation";
import type { StoryboardPorts, StoryboardVideo } from "./ports";
import { isGenerated, type Plan } from "./rules";
import type { Output } from "./schema";
import { parseStoredStoryboard, readVideoBudget } from "./variables";

// « Régénérer ce plan » : une nouvelle tentative pour un plan généré, avec le prompt modifié par l'humain.

export type RegenerationResult = { ok: boolean; message: string };

/** Avant le rendu : visuels en cours, montage, ou vidéo bloquée à l'une de ces étapes. */
const REGENERABLE_STAGES: readonly Stage[] = ["VISUALS_AND_AUDIO", "EDIT"];

export function canRegenerateAt(video: Pick<StoryboardVideo, "stage" | "blockedAt">): boolean {
  if (REGENERABLE_STAGES.includes(video.stage)) return true;
  return video.stage === "NEEDS_FIX" && video.blockedAt !== null && REGENERABLE_STAGES.includes(video.blockedAt);
}

export type RegenerationInput = { videoId: string; planId: string; prompt: string };

export async function regeneratePlan(ports: StoryboardPorts, input: RegenerationInput): Promise<RegenerationResult> {
  const video = await ports.loadVideo(input.videoId);
  if (!video) return { ok: false, message: "Vidéo introuvable." };
  if (!canRegenerateAt(video)) return { ok: false, message: "Un plan ne se régénère qu'avant le rendu (visuels, montage, ou vidéo bloquée à ces étapes)." };
  const storyboard = parseStoredStoryboard(video.storyboard);
  const plan = storyboard?.plans.find((entry) => entry.id === input.planId);
  if (!storyboard || !plan) return { ok: false, message: `Plan ${input.planId} introuvable dans le storyboard.` };
  if (!isGenerated(plan.type)) return { ok: false, message: `${plan.id} n'est pas un plan généré par IA : rien à régénérer.` };
  return regenerate(ports, { id: input.videoId, ...video }, storyboard, { ...plan, prompt_en: input.prompt.trim() });
}

async function regenerate(ports: StoryboardPorts, video: StoryboardVideo & { id: string }, storyboard: Output, plan: Plan): Promise<RegenerationResult> {
  const attempt = (await ports.media.countGenerations(video.id, plan.id)) + 1;
  const perVideo = readVideoBudget(ports.budgets());
  const outcome = await generateMedia(ports.media, {
    videoId: video.id,
    plans: [plan],
    remainingBudget: perVideo === null ? null : perVideo - video.totalCost,
    isStillActive: async () => {
      const current = await ports.loadVideo(video.id);
      return current !== null && canRegenerateAt(current);
    },
    attemptOf: () => attempt,
  });
  const refusal = outcomeBlockReason(outcome);
  if (refusal) return { ok: false, message: refusal.replace(/^Directeur artistique : /, "") };
  if (outcome.status === "stopped") return { ok: false, message: "La vidéo a changé d'étape : régénération annulée." };
  await ports.saveStoryboard(video.id, withPlan(storyboard, plan));
  return { ok: true, message: `${plan.id} régénéré (tentative ${attempt}).` };
}

function withPlan(storyboard: Output, plan: Plan): Output {
  return { ...storyboard, plans: storyboard.plans.map((entry) => (entry.id === plan.id ? plan : entry)) };
}
