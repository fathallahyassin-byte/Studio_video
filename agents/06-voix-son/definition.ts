import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentContext, AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createPrismaAudioPorts, type AudioPorts, type AudioVideo } from "./ports";
import { checkAudioPlan, normalizeAudioPlan } from "./rules";
import { outputSchema, type Output } from "./schema";
import { BLOCK_PREFIX, produceSoundtrack, type SoundtrackOutcome } from "./soundtrack";
import {
  buildAudioContext,
  formatScriptVariable,
  formatStoryboardVariable,
  formatTts,
  formatTtsTags,
  parseAudioSettings,
  readAudioSettings,
  readScript,
  readStoryboard,
  ttsTagNames,
} from "./variables";

// Agent 6 — Voix et son : prépare le texte de la voix, la musique et les effets, puis fait générer la voix,
// mesure sa durée, récupère l'horodatage et choisit une musique sous licence avant de passer au montage.

const meta = getAgentMeta(6);

export type AudioDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createAudioDefinition(getPorts: () => AudioPorts): AudioDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input, ctx) {
      const ports = getPorts();
      const videoId = requireVideoId(input);
      const video = await loadVideo(ports, videoId);
      const script = readScript(video.script);
      readAudioSettings(ctx.bible);
      const previous = input.note?.trim() ? await ports.loadLatestOutput(videoId) : null;
      return {
        SCRIPT: formatScriptVariable(script, input.note, previous),
        STORYBOARD: formatStoryboardVariable(readStoryboard(video.storyboard), script),
        TTS: formatTts(ports.tools.tts),
        BALISES_TTS: formatTtsTags(ports.tools.tts),
      };
    },
    normalize(output, _input, ctx) {
      return normalizeAudioPlan(output, { loudnessLufs: readAudioSettings(ctx.bible).loudnessLufs });
    },
    async controls(output, input, ctx) {
      const ports = getPorts();
      const video = await loadVideo(ports, requireVideoId(input));
      const context = buildAudioContext(readScript(video.script), readStoryboard(video.storyboard), readAudioSettings(ctx.bible), ttsTagNames(ports.tools.tts));
      return checkAudioPlan(output, context);
    },
    async onSuccess(output, input, ctx) {
      await recordAudioPlan(getPorts(), requireVideoId(input), output, ctx);
    },
  };
}

function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("Voix et son travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

async function loadVideo(ports: AudioPorts, videoId: string): Promise<AudioVideo> {
  const video = await ports.loadVideo(videoId);
  if (!video) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  return video;
}

/**
 * Musique, voix, horodatage, puis plan sonore enregistré et passage au montage si le storyboard est prêt.
 * Idempotent : rejoué après un crash, il retrouve la voix déjà payée ; il ne fait rien si la vidéo a quitté
 * VISUALS_AND_AUDIO. Tant que la voix ou la musique n'est pas réglée : blocage et alerte, audioJson n'est pas écrit.
 */
export async function recordAudioPlan(ports: AudioPorts, videoId: string, output: Output, ctx: Pick<AgentContext, "bible">): Promise<void> {
  const video = await ports.loadVideo(videoId);
  if (video?.stage !== "VISUALS_AND_AUDIO") return;
  const outcome = await settleSoundtrack(ports, { videoId, video, output, bible: ctx.bible });
  if (outcome.status === "stopped" || !(await isStillProducing(ports, videoId))) return;
  if (outcome.status === "blocked") {
    await ports.blockVideo(videoId, outcome.reason);
    return;
  }
  // Écrit en dernier : completeStage (agent 5) n'avance pas la vidéo tant que la voix et la musique manquent.
  await ports.saveAudioPlan(videoId, outcome.plan);
  try {
    await ports.completeMedia(videoId);
  } catch (error) {
    // La vidéo a changé d'étape entre-temps (agent 5 l'a fait avancer, l'humain l'a abandonnée) : rien à faire.
    if (await isStillProducing(ports, videoId)) throw error;
  }
}

async function settleSoundtrack(
  ports: AudioPorts,
  input: { videoId: string; video: AudioVideo; output: Output; bible: string | null },
): Promise<SoundtrackOutcome> {
  const parsed = input.bible === null ? null : parseAudioSettings(input.bible);
  if (!parsed?.ok) return { status: "blocked", reason: `${BLOCK_PREFIX}la bible de l'appel est illisible (${parsed?.error ?? "aucune bible"}).` };
  return produceSoundtrack(ports, { ...input, settings: parsed.settings, isStillActive: () => isStillProducing(ports, input.videoId) });
}

async function isStillProducing(ports: AudioPorts, videoId: string): Promise<boolean> {
  const video = await ports.loadVideo(videoId);
  return video?.stage === "VISUALS_AND_AUDIO";
}

export const definition: AudioDefinition = createAudioDefinition(createPrismaAudioPorts);
