import type { Output as Timeline } from "../agents/07-monteur/schema";

// Calculs de la composition « Montage » (fonctions pures, testées). Imports relatifs uniquement :
// le bundler Remotion ne connaît pas l'alias « @/ » du projet.

export type { Timeline };
export type VideoClip = Timeline["pistes"]["video"][number];
export type TextClip = Timeline["pistes"]["texte"][number];
export type SubtitleCue = Timeline["pistes"]["sous_titres"][number];
export type AudioClip = Timeline["pistes"]["audio"][number];

export const COMPOSITION_ID = "Montage";
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** Prompt : entrée et sortie animées de 0,3 s au plus. */
export const ANIMATION_FRAMES = 9;
/** Écart ajouté à la musique hors de la parole quand le ducking est actif (elle remonte entre les phrases). */
export const DUCKING_LIFT_DB = 10;
/** Durée de la remontée ou de la baisse de la musique autour de la parole. */
export const DUCKING_RAMP_FRAMES = 8;

export function toFrame(seconds: number): number {
  return Math.round(seconds * FPS);
}

/** Durée d'une portion de timeline en images, au moins une. */
export function spanFrames(span: { debut_s: number; fin_s: number }): { from: number; durationInFrames: number } {
  const from = toFrame(span.debut_s);
  return { from, durationInFrames: Math.max(toFrame(span.fin_s) - from, 1) };
}

export function durationInFrames(timeline: Pick<Timeline, "duree_totale_s">): number {
  return Math.max(toFrame(timeline.duree_totale_s), 1);
}

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

export type ClipKind = "video" | "image" | "text" | "missing";

/** Plan de texte animé (src vide), fichier vidéo ou image, ou plan manquant (aplat neutre). */
export function clipKind(clip: Pick<VideoClip, "src" | "manquant">): ClipKind {
  if (clip.manquant) return "missing";
  if (clip.src === "") return "text";
  return VIDEO_EXTENSIONS.test(clip.src) ? "video" : "image";
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** Avancement de 0 à 1 dans le plan. */
export function progress(frame: number, length: number): number {
  return length <= 1 ? 1 : clamp01(frame / (length - 1));
}

export type Transform = { scale: number; x: number; y: number };

/** Mouvement du plan (choisi par le monteur) : zoom avant ou arrière lent, panoramique, ou léger zoom par défaut. */
export function movementAt(movement: string, frame: number, length: number): Transform {
  const t = progress(frame, length);
  const name = movement.toLowerCase();
  if (/(fixe|statique|aucun|none|static)/.test(name)) return { scale: 1, x: 0, y: 0 };
  if (/zoom.?(out|arri)/.test(name)) return { scale: 1.12 - 0.12 * t, x: 0, y: 0 };
  if (/pan.*(gauche|left)/.test(name)) return { scale: 1.1, x: 4 - 8 * t, y: 0 };
  if (/pan|panoramique|droite|right/.test(name)) return { scale: 1.1, x: -4 + 8 * t, y: 0 };
  if (/(haut|up|tilt)/.test(name)) return { scale: 1.1, x: 0, y: 4 - 8 * t };
  return { scale: 1 + 0.12 * t, x: 0, y: 0 };
}

export type Appearance = { opacity: number; scale: number; x: number; y: number };

const IDLE: Appearance = { opacity: 1, scale: 1, x: 0, y: 0 };

/** Transition d'entrée d'un plan, sur ANIMATION_FRAMES images : cut, fondu, whip ou zoom. */
export function transitionAt(transition: string, frame: number): Appearance {
  const t = clamp01(frame / ANIMATION_FRAMES);
  const name = transition.toLowerCase();
  if (name.includes("fondu") || name.includes("fade")) return { ...IDLE, opacity: t };
  if (name.includes("whip") || name.includes("slide")) return { ...IDLE, x: (1 - t) * 100 };
  if (name.includes("zoom")) return { ...IDLE, scale: 1.25 - 0.25 * t };
  return IDLE;
}

/** Entrée et sortie animées d'un texte (0,3 s au plus) : pop, slide, ou fondu par défaut. */
export function textAppearanceAt(animation: string, frame: number, length: number): Appearance {
  const window = Math.min(ANIMATION_FRAMES, Math.floor(length / 2));
  const enter = window === 0 ? 1 : clamp01(frame / window);
  const exit = window === 0 ? 1 : clamp01((length - 1 - frame) / window);
  const t = Math.min(enter, exit);
  const name = animation.toLowerCase();
  if (name.includes("pop")) return { opacity: t, scale: 0.6 + 0.4 * t, x: 0, y: 0 };
  if (name.includes("slide")) return { opacity: t, scale: 1, x: 0, y: (1 - t) * 6 };
  return { ...IDLE, opacity: t };
}

/** Haut ou centre ; tout le reste dans le bas de la zone sûre (rien dans les 20 % du bas). */
export function textTop(position: string): string {
  if (position === "haut") return "12%";
  if (position === "centre") return "44%";
  return "64%";
}

/** Le groupe affiché, coupé autour du mot actif (repéré à sa place dans l'ordre des entrées du groupe). */
export function splitCues(cues: readonly SubtitleCue[]): { before: string; active: string; after: string }[] {
  let cursor = 0;
  return cues.map((cue, index) => {
    if (index === 0 || cues[index - 1]?.mots !== cue.mots) cursor = 0;
    const found = cue.mots.indexOf(cue.mot_actif, cursor);
    const at = found === -1 ? cue.mots.length : found;
    const length = found === -1 ? 0 : cue.mot_actif.length;
    cursor = at + length;
    return { before: cue.mots.slice(0, at), active: cue.mots.slice(at, at + length), after: cue.mots.slice(at + length) };
  });
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Intervalles de parole, en images, d'après les sous-titres (un mot par entrée). */
export function speechSpans(cues: readonly SubtitleCue[]): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  for (const cue of cues) {
    const from = toFrame(cue.debut_s);
    const to = toFrame(cue.fin_s);
    const last = spans.at(-1);
    if (last && from - last.to <= DUCKING_RAMP_FRAMES) last.to = Math.max(last.to, to);
    else spans.push({ from, to });
  }
  return spans;
}

/** Distance (en images) entre `frame` et la parole la plus proche ; 0 pendant la parole. */
function distanceToSpeech(frame: number, spans: readonly { from: number; to: number }[]): number {
  return spans.reduce((best, span) => Math.min(best, frame < span.from ? span.from - frame : frame > span.to ? frame - span.to : 0), Number.POSITIVE_INFINITY);
}

/** Gain de la musique : `volume_db` pendant la parole ; avec ducking, remontée progressive entre les phrases. */
export function musicGainAt(frame: number, clip: Pick<AudioClip, "volume_db" | "ducking">, spans: readonly { from: number; to: number }[]): number {
  if (!clip.ducking) return dbToGain(clip.volume_db);
  const lift = Math.min(distanceToSpeech(frame, spans) / DUCKING_RAMP_FRAMES, 1) * DUCKING_LIFT_DB;
  return dbToGain(Math.min(clip.volume_db + lift, 0));
}
