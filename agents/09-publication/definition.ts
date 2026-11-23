import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { recordPublicationPlan } from "./plan";
import { createPrismaPublicationPorts, type PublicationPorts, type PublicationVideo } from "./ports";
import { checkOutput, normalizeOutput, type PublicationContext } from "./rules";
import { outputSchema } from "./schema";
import { formatKeywords, formatQaReport, formatSlotsVariable, readIdeaId, readQaReport, readScript, requireLabels, requireV3Approval } from "./variables";

// Agent 9 — Publication : textes et réglages par plateforme, créneaux, puis Publications programmées.
// Les étiquettes IA viennent du rapport qualité et sont imposées en code ; rien ne part sans V3 approuvée.

const meta = getAgentMeta(9);

export type PublicationDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createPublicationDefinition(getPorts: () => PublicationPorts): PublicationDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const ports = getPorts();
      const videoId = requireVideoId(input);
      const video = await loadPublishableVideo(ports, videoId);
      const now = ports.now();
      const [keywords, taken] = await Promise.all([ports.loadKeywords(), ports.loadTakenSlots(video.channelId, videoId, now)]);
      return {
        SCRIPT: JSON.stringify(readScript(video.script), null, 2),
        RAPPORT_QA: formatQaReport(readQaReport(video.qaReport), requireLabels(video.qaReport)),
        MOTS_CLES: formatKeywords(keywords),
        CRENEAUX: formatSlotsVariable({ now, taken, note: input.note }),
      };
    },
    async normalize(output, input) {
      return normalizeOutput(output, await loadContext(getPorts(), input));
    },
    async controls(output, input) {
      return checkOutput(output, await loadContext(getPorts(), input));
    },
    async onSuccess(output, input) {
      await recordPublicationPlan(getPorts(), requireVideoId(input), output);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("La publication travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

/** Préconditions : la vidéo existe, a une V3 approuvée, un script et un rapport qualité lisibles. */
async function loadPublishableVideo(ports: PublicationPorts, videoId: string): Promise<PublicationVideo> {
  const video = await ports.loadVideo(videoId);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  requireV3Approval(video);
  readScript(video.script);
  requireLabels(video.qaReport);
  return video;
}

/** Relu à chaque étape (normalize, controls) : aucun état gardé entre deux appels. */
async function loadContext(ports: PublicationPorts, input: AgentJobInput): Promise<PublicationContext> {
  const video = await loadPublishableVideo(ports, requireVideoId(input));
  return { ideaId: readIdeaId(video.idea, readScript(video.script)), labels: requireLabels(video.qaReport), now: ports.now() };
}

export const definition: PublicationDefinition = createPublicationDefinition(createPrismaPublicationPorts);
