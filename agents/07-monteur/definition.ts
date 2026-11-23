import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createPrismaEditPorts, type EditPorts } from "./ports";
import { checkTimeline, missingMediaAlert, missingPlanIds, normalizeTimeline } from "./rules";
import { outputSchema, type Output } from "./schema";
import { inspectSources, requireEditContext, type EditContext, type EditSources } from "./sources";
import { buildPromptVariables } from "./variables";

// Agent 7 — Monteur : assemble storyboard, voix, musique et médias en une timeline de rendu.
// Le modèle choisit le rythme et les transitions ; durée, format, sous-titres, audio et fichiers sont imposés en code.

const meta = getAgentMeta(7);

export type EditorDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createEditorDefinition(getPorts: () => EditPorts): EditorDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const sources = await loadSources(getPorts(), requireVideoId(input));
      return buildPromptVariables(requireEditContext(sources), input.note, sources.previous);
    },
    async normalize(output, input) {
      return normalizeTimeline(output, await loadContext(getPorts(), input));
    },
    async controls(output, input) {
      return checkTimeline(output, await loadContext(getPorts(), input));
    },
    async onSuccess(output, input) {
      await recordTimeline(getPorts(), requireVideoId(input), output);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("Le monteur travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

/** Relu à chaque étape (variables, normalize, controls) : aucun état gardé entre deux appels. */
async function loadSources(ports: EditPorts, videoId: string): Promise<EditSources> {
  const [video, assets] = await Promise.all([ports.loadVideo(videoId), ports.loadAssets(videoId)]);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  return inspectSources(video, assets);
}

async function loadContext(ports: EditPorts, input: AgentJobInput): Promise<EditContext> {
  return requireEditContext(await loadSources(ports, requireVideoId(input)));
}

async function isStillEditing(ports: EditPorts, videoId: string): Promise<boolean> {
  const video = await ports.loadVideo(videoId);
  return video?.stage === "EDIT";
}

/** La timeline ne monte plus la voix ou la musique enregistrées aujourd'hui pour la vidéo. */
export function usesOutdatedSound(timeline: Output, sources: Pick<EditSources, "voice" | "music">): boolean {
  const srcOf = (type: "voix" | "musique") => timeline.pistes.audio.find((clip) => clip.type === type)?.src ?? null;
  return srcOf("voix") !== (sources.voice?.url ?? null) || srcOf("musique") !== (sources.music?.url ?? null);
}

/**
 * Enregistre la timeline, puis passe au rendu. Si un plan n'a pas de fichier, la vidéo est bloquée avec la liste
 * (le rendu serait troué) : « Relancer l'étape » refait le montage une fois les fichiers ajoutés.
 * Idempotent : sans effet si la vidéo n'est plus au montage (rendu lancé, blocage, abandon).
 */
export async function recordTimeline(ports: EditPorts, videoId: string, timeline: Output): Promise<void> {
  const video = await ports.loadVideo(videoId);
  if (video?.stage !== "EDIT") return;
  // Son changé pendant le montage (voix régénérée, musique choisie) : un nouveau montage est déjà en file.
  if (usesOutdatedSound(timeline, inspectSources(video, await ports.loadAssets(videoId)))) return;
  await ports.saveTimeline(videoId, timeline);
  const missing = missingPlanIds(timeline);
  try {
    if (missing.length > 0) await ports.blockVideo(videoId, `Monteur : ${missingMediaAlert(missing)}`);
    else await ports.completeEdit(videoId);
  } catch (error) {
    // La vidéo a changé d'étape entre-temps (abandon, autre passage) : rien à faire.
    if (await isStillEditing(ports, videoId)) throw error;
  }
}

export const definition: EditorDefinition = createEditorDefinition(createPrismaEditPorts);
