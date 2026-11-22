import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentContext, AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createPrismaScriptPorts, PUBLISHED_SCRIPTS_LIMIT, type ScriptPorts, type ScriptVideo } from "./ports";
import { checkScript, normalizeScript, type ScriptContext } from "./rules";
import { outputSchema, type Output } from "./schema";
import {
  formatDossierVariable,
  formatDuration,
  formatIdeaVariable,
  formatLearnings,
  formatPublishedScripts,
  indexFacts,
  parseStoredScript,
  readDossier,
  readIdeaId,
  readLearnings,
  readScriptTarget,
} from "./variables";

// Agent 4 — Scénariste : script minuté et trois accroches, d'après l'idée validée et le dossier factuel.

const meta = getAgentMeta(4);

export type ScriptDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createScriptDefinition(getPorts: () => ScriptPorts): ScriptDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input, ctx) {
      const ports = getPorts();
      const video = await loadScriptableVideo(ports, requireVideoId(input));
      const dossier = readDossier(video.dossier);
      const target = readScriptTarget(ctx.bible);
      const [report, publishedScripts] = await Promise.all([
        ports.loadLatestReport(input.channelId),
        ports.loadPublishedScripts(input.channelId, PUBLISHED_SCRIPTS_LIMIT),
      ]);
      return {
        IDEE: formatIdeaVariable(video.idea, input.note, parseStoredScript(video.script)),
        DOSSIER: formatDossierVariable(dossier),
        APPRENTISSAGES: formatLearnings(readLearnings(report)),
        DERNIERS_SCRIPTS: formatPublishedScripts(publishedScripts),
        DUREE_S: formatDuration(target.durationS),
      };
    },
    async normalize(output, input, ctx) {
      const { target, facts } = await loadScriptContext(getPorts(), input, ctx);
      return normalizeScript(output, target, facts);
    },
    async controls(output, input, ctx) {
      return checkScript(output, await loadScriptContext(getPorts(), input, ctx));
    },
    async onSuccess(output, input) {
      await recordScript(getPorts(), requireVideoId(input), output);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("Le scénariste travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

async function loadScriptableVideo(ports: ScriptPorts, videoId: string): Promise<ScriptVideo> {
  const video = await ports.loadVideo(videoId);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  if (video.idea === null) throw new AgentPreconditionError("La vidéo n'a pas d'idée (ideaJson vide) : rien à scénariser.");
  return video;
}

/** Cible (bible de l'appel) et faits (dossier de la vidéo) : les mêmes que ceux donnés au modèle. */
async function loadScriptContext(ports: ScriptPorts, input: AgentJobInput, ctx: AgentContext): Promise<ScriptContext> {
  const video = await loadScriptableVideo(ports, requireVideoId(input));
  return { target: readScriptTarget(ctx.bible), facts: indexFacts(readDossier(video.dossier)), ideaId: readIdeaId(video.idea) };
}

/**
 * Enregistre le script puis passe la vidéo en attente de V2. Idempotent : rejoué après un crash,
 * il ne fait rien si la vidéo a déjà quitté l'étape SCRIPT (en V2, bloquée ou abandonnée).
 */
export async function recordScript(ports: ScriptPorts, videoId: string, script: Output): Promise<void> {
  if (!(await isStillScripting(ports, videoId))) return;
  await ports.saveScript(videoId, script);
  try {
    await ports.completeScript(videoId);
  } catch (error) {
    // La vidéo a changé d'étape entre la lecture et la transition (décision humaine simultanée) : rien à faire.
    if (await isStillScripting(ports, videoId)) throw error;
  }
}

async function isStillScripting(ports: ScriptPorts, videoId: string): Promise<boolean> {
  const video = await ports.loadVideo(videoId);
  return video?.stage === "SCRIPT";
}

export const definition: ScriptDefinition = createScriptDefinition(createPrismaScriptPorts);
