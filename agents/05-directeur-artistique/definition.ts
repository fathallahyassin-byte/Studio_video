import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentContext, AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { generateMedia, outcomeBlockReason, type GenerationOutcome } from "./generation";
import { createPrismaStoryboardPorts, type StoryboardPorts, type StoryboardVideo } from "./ports";
import { checkStoryboard, normalizeStoryboard, TOLERANCE_S, type StoryboardContext } from "./rules";
import { outputSchema, type Output } from "./schema";
import {
  formatBudgetSeconds,
  formatScriptVariable,
  formatVisualTools,
  parseStoredStoryboard,
  readScript,
  readStyleSuffix,
  readVideoAiBudget,
  readVideoBudget,
  scriptBeats,
  scriptEnd,
} from "./variables";

// Agent 5 — Directeur artistique : découpe le script validé en plans et écrit les prompts visuels,
// puis fait générer les médias plan par plan avant de passer au montage (avec le plan sonore de l'agent 6).

const meta = getAgentMeta(5);

export type StoryboardDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createStoryboardDefinition(getPorts: () => StoryboardPorts): StoryboardDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const ports = getPorts();
      const video = await loadVideoWithScript(ports, requireVideoId(input));
      const { tools } = ports.media;
      return {
        SCRIPT: formatScriptVariable(readScript(video.script), input.note, parseStoredStoryboard(video.previousStoryboard)),
        OUTILS_VISUELS: formatVisualTools({ image: tools.image?.name ?? null, video: tools.video?.name ?? null }),
        BUDGET_SECONDES_VIDEO_IA: formatBudgetSeconds(readVideoAiBudget(ports.budgets())),
      };
    },
    normalize(output) {
      return normalizeStoryboard(output);
    },
    async controls(output, input, ctx) {
      return checkStoryboard(output, await loadStoryboardContext(getPorts(), input, ctx));
    },
    async onSuccess(output, input) {
      await recordStoryboard(getPorts(), requireVideoId(input), output);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("Le directeur artistique travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

async function loadVideoWithScript(ports: StoryboardPorts, videoId: string): Promise<StoryboardVideo> {
  const video = await ports.loadVideo(videoId);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  return video;
}

/** Script de la vidéo, budget et outils : les mêmes que ceux donnés au modèle ; bible de l'appel pour le style. */
async function loadStoryboardContext(ports: StoryboardPorts, input: AgentJobInput, ctx: AgentContext): Promise<StoryboardContext> {
  const video = await loadVideoWithScript(ports, requireVideoId(input));
  const script = readScript(video.script);
  return {
    ideaId: script.idee_id,
    beats: scriptBeats(script),
    scriptEndS: scriptEnd(script),
    videoAiBudgetS: readVideoAiBudget(ports.budgets()),
    tools: { image: ports.media.tools.image !== null, video: ports.media.tools.video !== null },
    styleSuffix: readStyleSuffix(ctx.bible),
  };
}

/**
 * Génère les médias, enregistre le storyboard puis passe au montage si le plan sonore est prêt.
 * Idempotent : rejoué après un crash, il saute les générations déjà faites ; il ne fait rien si la vidéo
 * a quitté VISUALS_AND_AUDIO (montage, blocage, abandon). Au-delà d'un budget : blocage et alerte, sans génération.
 */
export async function recordStoryboard(ports: StoryboardPorts, videoId: string, storyboard: Output): Promise<void> {
  const video = await ports.loadVideo(videoId);
  if (video?.stage !== "VISUALS_AND_AUDIO") return;

  const blockReason = videoAiOverBudget(ports, storyboard) ?? outcomeBlockReason(await generate(ports, videoId, video, storyboard));
  if (!(await isStillProducing(ports, videoId))) return;
  if (blockReason) {
    // Bloquée d'abord : le plan sonore ne peut plus faire avancer la vidéo. Le storyboard reste visible pour l'humain.
    await ports.blockVideo(videoId, blockReason);
    await ports.saveStoryboard(videoId, storyboard);
    return;
  }
  // Enregistré après la génération : completeStage (agent 6) n'avance pas la vidéo tant que les médias manquent.
  await ports.saveStoryboard(videoId, storyboard);
  try {
    await ports.completeMedia(videoId);
  } catch (error) {
    // La vidéo a changé d'étape entre-temps (agent 6 l'a fait avancer, l'humain l'a abandonnée) : rien à faire.
    if (await isStillProducing(ports, videoId)) throw error;
  }
}

/** Garde-fou en plus du contrôle renvoyé au modèle (budget changé entre deux passages, sortie rejouée). */
function videoAiOverBudget(ports: StoryboardPorts, storyboard: Output): string | null {
  const budget = readVideoAiBudget(ports.budgets());
  if (storyboard.secondes_video_ia <= budget + TOLERANCE_S) return null;
  return `Directeur artistique : ${storyboard.secondes_video_ia} s de vidéo IA pour un budget de ${budget} s (BUDGET_SECONDES_VIDEO_IA). Rien n'a été généré.`;
}

function generate(ports: StoryboardPorts, videoId: string, video: StoryboardVideo, storyboard: Output): Promise<GenerationOutcome> {
  const perVideo = readVideoBudget(ports.budgets());
  return generateMedia(ports.media, {
    videoId,
    plans: storyboard.plans,
    remainingBudget: perVideo === null ? null : perVideo - video.totalCost,
    isStillActive: () => isStillProducing(ports, videoId),
  });
}

async function isStillProducing(ports: StoryboardPorts, videoId: string): Promise<boolean> {
  const video = await ports.loadVideo(videoId);
  return video?.stage === "VISUALS_AND_AUDIO";
}

export const definition: StoryboardDefinition = createStoryboardDefinition(createPrismaStoryboardPorts);
