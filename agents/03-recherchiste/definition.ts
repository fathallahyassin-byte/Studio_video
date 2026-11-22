import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createPrismaResearchPorts, type ResearchPorts, type ResearchVideo } from "./ports";
import { checkDossier, decideOutcome, formatIdeaVariable, formatSourcesVariable, normalizeDossier, readIdeaId } from "./rules";
import { outputSchema, type Output } from "./schema";

// Agent 3 — Recherchiste & fact-checker : dossier factuel sourcé d'une idée validée en V1.

const meta = getAgentMeta(3);

export type ResearchDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createResearchDefinition(getPorts: () => ResearchPorts): ResearchDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const videoId = requireVideoId(input);
      const ports = getPorts();
      const video = await loadVideoWithIdea(ports, videoId);
      return {
        IDEE: formatIdeaVariable(video.idea, input.note),
        SOURCES: formatSourcesVariable(await ports.loadHumanSources(videoId)),
      };
    },
    normalize(output) {
      return normalizeDossier(output);
    },
    async controls(output, input) {
      const video = await getPorts().loadVideo(requireVideoId(input));
      return checkDossier(output, readIdeaId(video?.idea ?? null));
    },
    async onSuccess(output, input) {
      await recordDossier(getPorts(), requireVideoId(input), output);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("Le recherchiste travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

async function loadVideoWithIdea(ports: ResearchPorts, videoId: string): Promise<ResearchVideo> {
  const video = await ports.loadVideo(videoId);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  if (video.idea === null) throw new AgentPreconditionError("La vidéo n'a pas d'idée (ideaJson vide) : rien à documenter.");
  return video;
}

/**
 * Enregistre le dossier puis fait avancer ou bloque la vidéo. Idempotent : rejoué après un crash,
 * il ne fait rien si la vidéo a déjà quitté la recherche (avancée, bloquée ou abandonnée).
 */
export async function recordDossier(ports: ResearchPorts, videoId: string, dossier: Output): Promise<void> {
  if (!(await isStillResearching(ports, videoId))) return;
  await ports.saveDossier(videoId, dossier);
  const outcome = decideOutcome(dossier);
  try {
    if (outcome.kind === "advance") await ports.completeResearch(videoId);
    else await ports.block(videoId, outcome.reason);
  } catch (error) {
    // La vidéo a changé d'étape entre la lecture et la transition (décision humaine simultanée) : rien à faire.
    if (await isStillResearching(ports, videoId)) throw error;
  }
}

async function isStillResearching(ports: ResearchPorts, videoId: string): Promise<boolean> {
  const video = await ports.loadVideo(videoId);
  return video?.stage === "RESEARCH";
}

export const definition: ResearchDefinition = createResearchDefinition(createPrismaResearchPorts);
