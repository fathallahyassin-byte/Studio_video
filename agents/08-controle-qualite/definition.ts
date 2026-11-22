import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentContext, AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { isGo } from "./checklist";
import { createPrismaQaPorts, HISTORY_LIMIT, type QaPorts, type QaVideo } from "./ports";
import { checkReport, formatBlockReason, normalizeReport, type QaContext } from "./rules";
import { outputSchema, type Output } from "./schema";
import {
  buildQaContext,
  formatAudioPlan,
  formatCaptures,
  formatHistoryVariable,
  formatStoryboard,
  formatTimeline,
  formatTranscription,
  readDossier,
  readPartnership,
  readScript,
  readSources,
  NO_PARTNERSHIP,
} from "./variables";

// Agent 8 — Contrôle qualité : check-list A à F sur la vidéo rendue, décision GO ou NO-GO avec preuves.

const meta = getAgentMeta(8);

export type QaDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createQaDefinition(getPorts: () => QaPorts): QaDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const ports = getPorts();
      const videoId = requireVideoId(input);
      const video = await loadCheckableVideo(ports, videoId);
      const [assets, evidence, published] = await Promise.all([
        ports.loadAssets(videoId),
        ports.loadRenderEvidence(videoId),
        ports.loadPublishedVideos(input.channelId, HISTORY_LIMIT),
      ]);
      const sources = readSources(video, evidence);
      const partnership = readPartnership(video.partnership);
      const hasPartnership = partnership !== NO_PARTNERSHIP;
      return {
        DOSSIER: JSON.stringify(readDossier(video.dossier), null, 2),
        SCRIPT: JSON.stringify(readScript(video.script), null, 2),
        STORYBOARD: formatStoryboard(sources, assets, hasPartnership),
        PLAN_SONORE: formatAudioPlan(sources, assets, hasPartnership),
        TIMELINE: formatTimeline(sources, hasPartnership),
        TRANSCRIPTION: formatTranscription(sources, hasPartnership),
        CAPTURES: formatCaptures(sources, hasPartnership),
        PARTENARIAT: partnership,
        HISTORIQUE: formatHistoryVariable(published, input.note, video.previousReport),
      };
    },
    async normalize(output, input, ctx) {
      return normalizeReport(output, await loadQaContext(getPorts(), input, ctx));
    },
    async controls(output, input, ctx) {
      return checkReport(output, await loadQaContext(getPorts(), input, ctx));
    },
    async onSuccess(output, input) {
      await recordReport(getPorts(), requireVideoId(input), output);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("Le contrôle qualité travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

/** Préconditions : la vidéo existe, avec un dossier et un script lisibles. */
async function loadCheckableVideo(ports: QaPorts, videoId: string): Promise<QaVideo> {
  const video = await ports.loadVideo(videoId);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  readDossier(video.dossier);
  readScript(video.script);
  return video;
}

/** Sources, médias et cible : les mêmes que ceux donnés au modèle, relus à chaque étape. */
async function loadQaContext(ports: QaPorts, input: AgentJobInput, ctx: AgentContext): Promise<QaContext> {
  const videoId = requireVideoId(input);
  const video = await loadCheckableVideo(ports, videoId);
  return buildQaContext(video, await ports.loadRenderEvidence(videoId), ctx.bible);
}

/**
 * Enregistre le rapport, puis GO ou GO_AVEC_CORRECTIONS → attente de V3, NO_GO → à corriger.
 * Idempotent : rejoué après un crash, il ne fait rien si la vidéo a déjà quitté l'étape QA.
 */
export async function recordReport(ports: QaPorts, videoId: string, report: Output): Promise<void> {
  if (!(await isInQa(ports, videoId))) return;
  await ports.saveReport(videoId, report);
  try {
    if (isGo(report.decision)) await ports.passQa(videoId);
    else await ports.blockQa(videoId, formatBlockReason(report));
  } catch (error) {
    // La vidéo a changé d'étape entre la lecture et la transition (décision humaine simultanée) : rien à faire.
    if (await isInQa(ports, videoId)) throw error;
  }
}

async function isInQa(ports: QaPorts, videoId: string): Promise<boolean> {
  const video = await ports.loadVideo(videoId);
  return video?.stage === "QA";
}

export const definition: QaDefinition = createQaDefinition(createPrismaQaPorts);
