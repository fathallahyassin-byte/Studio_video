import { z } from "zod";
import { outputSchema as storyboardSchema } from "@/agents/05-directeur-artistique/schema";
import { outputSchema as audioPlanSchema } from "@/agents/06-voix-son/schema";
import { AgentPreconditionError } from "@/lib/agents/errors";
import type { WordTiming } from "@/lib/providers/media";
import type { EditAsset, EditVideo } from "./ports";
import { outputSchema as timelineSchema, type Output } from "./schema";
import { cleanWords, lastWordEnd, type SpokenWord } from "./subtitles";

// Lecture des entrées du monteur : storyboard (agent 5), plan sonore et voix (agent 6), fichiers enregistrés.
// Fonctions pures : le panneau et la définition lisent les mêmes sources de la même façon.

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardPlan = Storyboard["plans"][number];
export type AudioPlan = z.infer<typeof audioPlanSchema>;

export type Optional<T> = { status: "ok"; value: T } | { status: "absent" } | { status: "unreadable" };

/** Fichier visuel d'un plan (dernier Asset IMAGE ou VIDEO enregistré pour ce plan). */
export type PlanMedia = { planId: string; url: string; kind: "IMAGE" | "VIDEO" };

export type VoiceSource = {
  url: string;
  /** durée mesurée par le moteur ; null si elle n'a pas été enregistrée */
  measuredS: number | null;
  /** horodatage brut ; null si aucun n'a été enregistré */
  words: WordTiming[] | null;
};

export type MusicSource = { url: string; license: string };

export type AudioDeliverable = { voice: VoiceSource | null; music: MusicSource | null };

export type EditSources = {
  storyboard: Optional<Storyboard>;
  audio: Optional<AudioPlan>;
  voice: VoiceSource | null;
  music: MusicSource | null;
  media: PlanMedia[];
  previous: Output | null;
};

/** Tout ce que le montage lit, une fois les préconditions vérifiées. */
export type EditContext = {
  ideaId: string;
  /** plans du storyboard, dans l'ordre du temps */
  plans: StoryboardPlan[];
  audioPlan: AudioPlan;
  voice: { url: string; durationS: number; measured: boolean };
  /** horodatage nettoyé : base des sous-titres */
  words: SpokenWord[];
  lastWordEndS: number;
  music: MusicSource | null;
  media: PlanMedia[];
};

function readOptional<T>(schema: z.ZodType<T>, value: unknown): Optional<T> {
  if (value === null || value === undefined) return { status: "absent" };
  const parsed = schema.safeParse(value);
  return parsed.success ? { status: "ok", value: parsed.data } : { status: "unreadable" };
}

// ---------------------------------------------------------------------------
// Livrable audio de l'agent 6 : SEULE fonction qui connaît le format de son bloc « production ».
// ---------------------------------------------------------------------------

/**
 * Bloc « production » que le fork de l'agent 6 écrit dans Video.audioJson à côté de la sortie du modèle
 * (voix générée, durée mesurée, horodatage mot à mot, musique sous licence). Absent de `main` aujourd'hui :
 * lu de façon tolérante, et les Asset VOICE / MUSIC servent de secours. Voir NEEDS.md.
 */
const productionSchema = z.object({
  production: z.object({
    voix: z
      .object({
        url: z.string().trim().min(1),
        duree_s: z.number().nonnegative().optional(),
        mots: z.array(z.object({ word: z.string(), startS: z.number(), endS: z.number() })).optional(),
      })
      .optional(),
    musique: z.object({ url: z.string().trim().min(1), licence: z.string() }).optional(),
  }),
});

function latestOfType(assets: readonly EditAsset[], type: EditAsset["type"]): EditAsset | null {
  return assets.find((asset) => asset.type === type && asset.url.trim() !== "") ?? null;
}

function licensed(url: string, license: string | null): MusicSource | null {
  const trimmed = license?.trim() ?? "";
  return trimmed === "" ? null : { url, license: trimmed };
}

export function readAudioDeliverable(audioJson: unknown, assets: readonly EditAsset[]): AudioDeliverable {
  const parsed = productionSchema.safeParse(audioJson);
  const production = parsed.success ? parsed.data.production : null;
  const voiceAsset = latestOfType(assets, "VOICE");
  const musicAsset = latestOfType(assets, "MUSIC");

  const voiceUrl = production?.voix?.url ?? voiceAsset?.url ?? null;
  const voice: VoiceSource | null =
    voiceUrl === null ? null : { url: voiceUrl, measuredS: production?.voix?.duree_s ?? voiceAsset?.durationS ?? null, words: production?.voix?.mots ?? null };
  // Une musique sans licence n'est jamais utilisée (CLAUDE.md §8).
  const music = production?.musique ? licensed(production.musique.url, production.musique.licence) : musicAsset ? licensed(musicAsset.url, musicAsset.license) : null;
  return { voice, music };
}

// ---------------------------------------------------------------------------
// Sources, problèmes bloquants et médias manquants.
// ---------------------------------------------------------------------------

/** Dernier fichier IMAGE ou VIDEO de chaque plan. */
export function planMedia(assets: readonly EditAsset[]): PlanMedia[] {
  const seen = new Set<string>();
  const media: PlanMedia[] = [];
  for (const asset of assets) {
    if ((asset.type !== "IMAGE" && asset.type !== "VIDEO") || asset.planId === null || seen.has(asset.planId)) continue;
    seen.add(asset.planId);
    media.push({ planId: asset.planId, url: asset.url, kind: asset.type });
  }
  return media;
}

export function parseStoredTimeline(value: unknown): Output | null {
  const parsed = timelineSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function inspectSources(video: EditVideo, assets: readonly EditAsset[]): EditSources {
  const { voice, music } = readAudioDeliverable(video.audio, assets);
  return {
    storyboard: readOptional(storyboardSchema, video.storyboard),
    audio: readOptional(audioPlanSchema, video.audio),
    voice,
    music,
    media: planMedia(assets),
    previous: parseStoredTimeline(video.timeline),
  };
}

function optionalIssue(status: Optional<unknown>["status"], label: string, owner: string): string | null {
  if (status === "absent") return `${label} absent : l'agent ${owner} ne l'a pas encore enregistré.`;
  if (status === "unreadable") return `${label} illisible (schéma de l'agent ${owner} non respecté).`;
  return null;
}

export const NO_VOICE = "Voix absente : aucun fichier voix enregistré (synthèse vocale non branchée ou voix pas encore générée).";
export const NO_TIMINGS = "Horodatage mot à mot absent : impossible de recaler les sous-titres sans le moteur TTS horodaté ni Whisper.";

/** Ce qui empêche le montage : aucun appel au modèle tant qu'il en reste un. */
export function blockingIssues(sources: EditSources): string[] {
  const issues = [
    optionalIssue(sources.storyboard.status, "Storyboard", "5 (directeur artistique)"),
    optionalIssue(sources.audio.status, "Plan sonore", "6 (voix et son)"),
    sources.voice === null ? NO_VOICE : null,
    sources.voice !== null && cleanWords(sources.voice.words ?? []).length === 0 ? NO_TIMINGS : null,
  ];
  return issues.filter((issue) => issue !== null);
}

/** Un plan de texte animé est dessiné par le moteur de rendu : il n'a pas besoin de fichier. */
export function needsFile(plan: Pick<StoryboardPlan, "type">): boolean {
  return plan.type !== "texte_anime";
}

/** Plans qui demandent un fichier et n'en ont pas. */
export function missingMedia(plans: readonly StoryboardPlan[], media: readonly PlanMedia[]): StoryboardPlan[] {
  return plans.filter((plan) => needsFile(plan) && !media.some((entry) => entry.planId === plan.id));
}

/** Précondition de buildVariables, normalize et controls : contexte complet, ou AgentPreconditionError sans appel. */
export function requireEditContext(sources: EditSources): EditContext {
  const issues = blockingIssues(sources);
  const { storyboard, audio, voice } = sources;
  if (issues.length > 0 || storyboard.status !== "ok" || audio.status !== "ok" || voice === null) {
    throw new AgentPreconditionError(`Montage impossible : ${issues.join(" ")}`);
  }
  const words = cleanWords(voice.words ?? []);
  const lastWordEndS = lastWordEnd(words);
  return {
    ideaId: storyboard.value.idee_id,
    plans: [...storyboard.value.plans].sort((a, b) => a.debut_s - b.debut_s),
    audioPlan: audio.value,
    voice: { url: voice.url, durationS: voice.measuredS ?? lastWordEndS, measured: voice.measuredS !== null },
    words,
    lastWordEndS,
    music: sources.music,
    media: sources.media,
  };
}
