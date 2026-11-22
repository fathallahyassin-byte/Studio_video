import { parse } from "yaml";
import { z } from "zod";
import { outputSchema as scriptSchema } from "@/agents/04-scenariste/schema";
import { outputSchema as storyboardSchema } from "@/agents/05-directeur-artistique/schema";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { checkBible } from "@/lib/bible/bible";
import type { TtsProvider } from "@/lib/providers/tts";
import { countWords, DEFAULT_LUFS, tagName, type AudioContext, type DurationTarget } from "./rules";
import type { Output } from "./schema";

// Texte des {{VARIABLES}} du prompt et lecture de leurs sources (script, storyboard, moteur TTS, bible).
// Une source absente devient une phrase explicite : le modèle n'invente ni moteur, ni balise, ni plan.

export type Script = z.infer<typeof scriptSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;

export const CORRECTION_HEADING = "CORRECTION DEMANDÉE PAR L'HUMAIN (prioritaire sur le reste)";
export const NO_TTS = "aucun moteur de synthèse vocale n'est branché pour l'instant (la voix sera générée plus tard)";
export const NO_TTS_TAGS = "aucune balise : marque les pauses par la ponctuation (virgule = courte, point = longue)";
export const NO_STORYBOARD =
  "PAS ENCORE DISPONIBLE : le directeur artistique découpe les plans en parallèle. Repère-toi sur les beats du script ci-dessous et, dans le champ « plan » des effets, écris le numéro du beat (B1, B2…), jamais un id de plan inventé.";

// ---------------------------------------------------------------------------
// Script validé (agent 4) et storyboard (agent 5).
// ---------------------------------------------------------------------------

/** Précondition : sans script lisible, il n'y a pas de voix à préparer, aucun appel. */
export function readScript(scriptJson: unknown): Script {
  if (scriptJson === null || scriptJson === undefined) {
    throw new AgentPreconditionError("La vidéo n'a pas de script (scriptJson vide) : pas de voix à préparer.");
  }
  const parsed = scriptSchema.safeParse(scriptJson);
  if (!parsed.success) throw new AgentPreconditionError("Le script de la vidéo est illisible (schéma du scénariste non respecté).");
  return parsed.data;
}

/** Storyboard enregistré ; null s'il n'existe pas encore ou s'il est illisible (on se rabat alors sur les beats). */
export function readStoryboard(storyboardJson: unknown): Storyboard | null {
  const parsed = storyboardSchema.safeParse(storyboardJson);
  return parsed.success ? parsed.data : null;
}

export function scriptEnd(script: Script): number {
  return Math.max(...script.beats.map((beat) => beat.fin_s));
}

export function scriptWords(script: Script): number {
  return script.beats.reduce((total, beat) => total + countWords(beat.voix), 0);
}

/**
 * {{SCRIPT}} : le script en JSON. Une note de l'humain (renvoi depuis V3, reprise) suit sous un intitulé
 * explicite, avec le plan sonore précédent s'il existe : le modèle corrige au lieu de repartir de zéro.
 */
export function formatScriptVariable(script: Script, note: string | null, previous: Output | null): string {
  const json = JSON.stringify(script, null, 2);
  const trimmedNote = note?.trim();
  if (!trimmedNote) return json;
  const correction = `${json}\n\n${CORRECTION_HEADING} :\n${trimmedNote}`;
  if (!previous) return correction;
  return `${correction}\n\nPlan sonore précédent, à corriger selon cette note :\n${JSON.stringify(previous)}`;
}

/** {{STORYBOARD}} : les plans s'ils existent déjà, sinon une phrase explicite et les beats du script. */
export function formatStoryboardVariable(storyboard: Storyboard | null, script: Script): string {
  if (storyboard) {
    const plans = storyboard.plans.map((plan) => ({ id: plan.id, beat: plan.beat, debut_s: plan.debut_s, fin_s: plan.fin_s, type: plan.type, transition_sortie: plan.transition_sortie }));
    return JSON.stringify(plans, null, 2);
  }
  const beats = script.beats.map((beat) => ({ plan: `B${beat.n}`, role: beat.role, debut_s: beat.debut_s, fin_s: beat.fin_s }));
  return `${NO_STORYBOARD}\n${JSON.stringify(beats, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Moteur de synthèse vocale.
// ---------------------------------------------------------------------------

export function formatTts(tts: Pick<TtsProvider, "name"> | null): string {
  return tts ? tts.name : NO_TTS;
}

/** {{BALISES_TTS}} : celles que déclare le moteur, ou la consigne de ponctuation sans moteur (ou sans balise). */
export function formatTtsTags(tts: Pick<TtsProvider, "supportedTags"> | null): string {
  if (!tts || tts.supportedTags.length === 0) return NO_TTS_TAGS;
  return tts.supportedTags.join(", ");
}

export function ttsTagNames(tts: Pick<TtsProvider, "supportedTags"> | null): string[] | null {
  return tts ? tts.supportedTags.map(tagName) : null;
}

// ---------------------------------------------------------------------------
// Bible : durée cible, débit, loudness, voix et langue.
// ---------------------------------------------------------------------------

export type AudioSettings = {
  target: DurationTarget & { wordsPerSecond: number };
  loudnessLufs: number;
  /** identité de la voix (identite.voix « moteur / id ») ; null si elle n'est pas renseignée */
  voiceId: string | null;
  language: string;
};

const extrasSchema = z.object({
  chaine: z.object({ langue: z.string().optional() }).optional(),
  format_video: z.object({ loudness_lufs: z.number().optional() }).optional(),
});

export function parseAudioSettings(bible: string): { ok: true; settings: AudioSettings } | { ok: false; error: string } {
  const checked = checkBible(bible);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { dureeMin, dureeMax, debitVoix, voix } = checked.fields;
  const extras = extrasSchema.safeParse(parse(bible));
  const langue = extras.success ? extras.data.chaine?.langue : undefined;
  return {
    ok: true,
    settings: {
      target: { minS: dureeMin, maxS: dureeMax, wordsPerSecond: debitVoix },
      loudnessLufs: (extras.success ? extras.data.format_video?.loudness_lufs : undefined) ?? DEFAULT_LUFS,
      voiceId: readVoiceId(voix),
      language: langue?.trim() || "fr-FR",
    },
  };
}

/** « moteur / id » → « id » ; « id » seul est accepté ; un gabarit non rempli (« {{ID_VOIX}} ») vaut null. */
export function readVoiceId(voice: string): string | null {
  const id = (voice.split("/").at(-1) ?? "").trim();
  return id === "" || id.includes("{{") ? null : id;
}

/** Précondition de buildVariables : sans bible lisible, ni durée cible ni débit, aucun appel. */
export function readAudioSettings(bible: string | null): AudioSettings {
  if (bible === null) throw new AgentPreconditionError("Aucune bible n'est adoptée : impossible de fixer la durée cible de la voix.");
  const parsed = parseAudioSettings(bible);
  if (!parsed.ok) throw new AgentPreconditionError(`Bible inutilisable pour la voix et le son : ${parsed.error}`);
  return parsed.settings;
}

// ---------------------------------------------------------------------------
// Contexte des contrôles.
// ---------------------------------------------------------------------------

export function buildAudioContext(script: Script, storyboard: Storyboard | null, settings: AudioSettings, ttsTags: readonly string[] | null): AudioContext {
  return {
    ideaId: script.idee_id,
    beats: script.beats.map((beat) => ({ n: beat.n, debut_s: beat.debut_s, fin_s: beat.fin_s })),
    scriptEndS: scriptEnd(script),
    scriptWords: scriptWords(script),
    plans: storyboard ? storyboard.plans.map((plan) => ({ id: plan.id, debut_s: plan.debut_s, fin_s: plan.fin_s })) : null,
    target: settings.target,
    ttsTags,
  };
}

// ---------------------------------------------------------------------------
// Budget (.env).
// ---------------------------------------------------------------------------

/** Montant positif lu dans .env ; null s'il est absent ou invalide (la génération payante est alors refusée). */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
