import { FPS, HEIGHT, WIDTH } from "./frames";
import { MAX_TAIL_S } from "./rules";
import type { Output } from "./schema";
import { needsFile, type EditContext, type StoryboardPlan } from "./sources";
import type { SpokenWord } from "./subtitles";

// Texte des {{VARIABLES}} du prompt. Tout ce qui manque est dit en clair : le modèle n'invente ni URL ni horodatage.

export const CORRECTION_HEADING = "CORRECTION DEMANDÉE PAR L'HUMAIN (prioritaire sur le reste)";

export const SUBTITLES_IN_CODE =
  'Les sous-titres sont recalés en code sur cet horodatage (groupes de 1 à 4 mots, mot actif) : renvoie "sous_titres": [].';

export const AUDIO_IN_CODE =
  "La piste audio (voix, musique sous licence, niveaux et ducking du plan sonore) est construite en code : renvoie \"audio\": [] ou les mêmes entrées.";

/**
 * {{SCHEMA_MOTEUR}} : aucune composition Remotion n'existe encore (étape 6 de la feuille de route).
 * La valeur le dit explicitement ; le prompt prévoit alors le format de sortie.
 */
export const ENGINE_SCHEMA = [
  "aucune composition Remotion n'est encore branchée : utilise exactement le FORMAT DE SORTIE ci-dessous, il deviendra tel quel les inputProps de la composition.",
  `Export imposé en code : ${WIDTH}×${HEIGHT}, ${FPS} images/s, H.264, AAC 48 kHz ; les temps sont recalés sur l'image (1/${FPS} s).`,
  'Plan de texte animé : "src": "" et "manquant": false (le moteur dessine le texte). Plan sans fichier fourni : "src": "" et "manquant": true.',
].join("\n");

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * {{STORYBOARD}} : les plans dans l'ordre du temps. Une note de l'humain (renvoi depuis V3, reprise) suit sous un
 * intitulé explicite, avec la timeline précédente si elle existe : le modèle corrige au lieu de repartir de zéro.
 */
export function formatStoryboardVariable(context: EditContext, note: string | null, previous: Output | null): string {
  const json = JSON.stringify({ idee_id: context.ideaId, plans: context.plans }, null, 2);
  const trimmedNote = note?.trim();
  if (!trimmedNote) return json;
  const correction = `${json}\n\n${CORRECTION_HEADING} :\n${trimmedNote}`;
  return previous ? `${correction}\n\nTimeline précédente, à corriger selon cette note :\n${JSON.stringify(previous)}` : correction;
}

/** {{PLAN_SONORE}} : la sortie du modèle de l'agent 6, plus ce qui sera vraiment monté. */
export function formatAudioPlanVariable(context: EditContext): string {
  const music = context.music ? `Musique sous licence fournie : ${context.music.url} (licence : ${context.music.license}).` : "Aucune musique sous licence n'est fournie : pas de piste musique.";
  const effects =
    context.audioPlan.effets.length > 0 ? "Aucun fichier d'effet sonore n'est fourni : ne place pas d'effet (ils sont signalés en alerte en code)." : "Aucun effet sonore prévu.";
  return `${JSON.stringify(context.audioPlan, null, 2)}\n\n${music}\n${effects}\n${AUDIO_IN_CODE}`;
}

export function formatVoiceUrl(context: EditContext): string {
  return context.voice.url;
}

/** {{DUREE_VOIX_S}} : un nombre, suivi de « s » dans le prompt. */
export function formatVoiceDuration(context: EditContext): string {
  return String(round(context.voice.durationS));
}

function compactWords(words: readonly SpokenWord[]): string {
  return JSON.stringify(words.map((word) => ({ mot: word.text, debut_s: round(word.startS), fin_s: round(word.endS) })));
}

/** {{MOTS_HORODATES}} : l'horodatage nettoyé (celui des sous-titres) et la fenêtre de fin imposée. */
export function formatWordTimings(context: EditContext): string {
  const last = round(context.lastWordEndS);
  const window = `Dernier mot à ${last} s : duree_totale_s entre ${last} et ${round(context.lastWordEndS + MAX_TAIL_S)} s (fin recalée en code sinon).`;
  return `${compactWords(context.words)}\n${SUBTITLES_IN_CODE}\n${window}`;
}

function mediaLine(plan: StoryboardPlan, context: EditContext): string {
  if (!needsFile(plan)) return `- ${plan.id} → aucun fichier : texte animé dessiné par le moteur ("src": "", "manquant": false)`;
  const media = context.media.find((entry) => entry.planId === plan.id);
  if (media) return `- ${plan.id} → ${media.url} (${media.kind === "VIDEO" ? "vidéo" : "image"})`;
  const why = plan.type === "stock" ? "séquence libre de droits pas encore sourcée" : "fichier pas encore généré";
  return `- ${plan.id} → MANQUANT (${why}) : "src": "", "manquant": true`;
}

/** {{MEDIAS}} : un fichier par plan, ou la mention explicite qu'il manque. */
export function formatMedia(context: EditContext): string {
  return `\n${context.plans.map((plan) => mediaLine(plan, context)).join("\n")}\n`;
}

/** Les 7 variables du prompt (la bible est injectée par runAgent). */
export function buildPromptVariables(context: EditContext, note: string | null, previous: Output | null): Record<string, string> {
  return {
    STORYBOARD: formatStoryboardVariable(context, note, previous),
    PLAN_SONORE: formatAudioPlanVariable(context),
    URL_VOIX: formatVoiceUrl(context),
    DUREE_VOIX_S: formatVoiceDuration(context),
    MOTS_HORODATES: formatWordTimings(context),
    MEDIAS: formatMedia(context),
    SCHEMA_MOTEUR: ENGINE_SCHEMA,
  };
}
