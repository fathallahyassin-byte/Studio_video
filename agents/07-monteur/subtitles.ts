import type { WordTiming } from "@/lib/providers/media";
import { frameOf, secondsOf } from "./frames";

// Recalage des sous-titres EN CODE (CLAUDE.md §5.6), à partir de l'horodatage mot à mot de la voix.
// Fonctions pures et déterministes : même horodatage, mêmes sous-titres. Le modèle n'y touche jamais.

/** Un mot prononcé, nettoyé : ponctuation rattachée, élisions et mots collés fusionnés, sans chevauchement. */
export type SpokenWord = { text: string; startS: number; endS: number };

/** Une entrée de la piste sous_titres : le groupe affiché et le mot prononcé à cet instant. */
export type SubtitleCue = { mots: string; debut_s: number; fin_s: number; mot_actif: string };

/** Prompt : « groupes de 1 à 4 mots ». */
export const MAX_WORDS_PER_GROUP = 4;
/** Prompt : « 2 lignes maximum ». */
export const MAX_LINES = 2;
/** Caractères par ligne dans la zone sûre (police des sous-titres de la composition : voir NEEDS.md). */
export const MAX_LINE_CHARS = 18;
/** Un silence plus long que ceci commence un nouveau groupe. */
export const PAUSE_S = 0.4;
/** Le groupe reste affiché un court instant après son dernier mot (jamais au-delà du groupe suivant). */
export const HOLD_S = 0.3;

const NBSP = " ";
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;
const OPENING = /^[«(\[“¿¡]+$/u;
/** Ponctuation précédée d'une espace (insécable) en français. */
const SPACED_BEFORE = /^[?!:;»%]/u;
const ELISION = /['’]$/u;
/** Fin de proposition : le groupe s'arrête après ce mot. */
const CLAUSE_END = /[.!?…;:,]["»)\]’”]*$/u;
const EDGE_PUNCTUATION = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu;

// ---------------------------------------------------------------------------
// Nettoyage de l'horodatage.
// ---------------------------------------------------------------------------

/** Mots vides ou aux temps invalides retirés, temps négatifs ramenés à 0, ordre chronologique (tri stable). */
function validWords(raw: readonly WordTiming[]): SpokenWord[] {
  return raw
    .map((word) => ({ text: word.word.trim(), startS: word.startS, endS: word.endS }))
    .filter((word) => word.text !== "" && Number.isFinite(word.startS) && Number.isFinite(word.endS))
    .map((word) => {
      const startS = Math.max(0, word.startS);
      return { text: word.text, startS, endS: Math.max(startS, word.endS) };
    })
    .sort((a, b) => a.startS - b.startS);
}

function separator(previous: SpokenWord, next: SpokenWord): string {
  if (PUNCTUATION_ONLY.test(next.text)) return SPACED_BEFORE.test(next.text) ? NBSP : "";
  if (ELISION.test(previous.text)) return "";
  return " ";
}

/** Ponctuation isolée, élision (« l' » + « eau ») ou mot qui démarre dans la même image : un seul mot affiché. */
function attachesTo(previous: SpokenWord, next: SpokenWord): boolean {
  return PUNCTUATION_ONLY.test(next.text) || ELISION.test(previous.text) || frameOf(next.startS) <= frameOf(previous.startS);
}

function attach(previous: SpokenWord, next: SpokenWord): SpokenWord {
  return { text: `${previous.text}${separator(previous, next)}${next.text}`, startS: previous.startS, endS: Math.max(previous.endS, next.endS) };
}

function withPrefix(prefix: string, word: SpokenWord): SpokenWord {
  if (prefix === "") return word;
  return { ...word, text: `${prefix}${prefix.endsWith("«") ? NBSP : ""}${word.text}` };
}

function mergeTokens(words: readonly SpokenWord[]): SpokenWord[] {
  const merged: SpokenWord[] = [];
  let prefix = "";
  for (const word of words) {
    const previous = merged.at(-1);
    if (OPENING.test(word.text)) {
      prefix += word.text;
    } else if (prefix === "" && previous && attachesTo(previous, word)) {
      merged[merged.length - 1] = attach(previous, word);
    } else {
      merged.push(withPrefix(prefix, word));
      prefix = "";
    }
  }
  const last = merged.at(-1);
  if (prefix !== "" && last) merged[merged.length - 1] = { ...last, text: `${last.text}${prefix}` };
  return merged;
}

/** Un mot ne déborde jamais sur le suivant (« mots collés » qui se chevauchent dans l'horodatage). */
function removeOverlaps(words: readonly SpokenWord[]): SpokenWord[] {
  return words.map((word, index) => {
    const next = words[index + 1];
    return next && word.endS > next.startS ? { ...word, endS: Math.max(word.startS, next.startS) } : word;
  });
}

export function cleanWords(raw: readonly WordTiming[]): SpokenWord[] {
  return removeOverlaps(mergeTokens(validWords(raw)));
}

/** Fin du dernier mot prononcé : la vidéo s'arrête au plus 0,5 s après. */
export function lastWordEnd(words: readonly SpokenWord[]): number {
  return words.reduce((end, word) => Math.max(end, word.endS), 0);
}

// ---------------------------------------------------------------------------
// Groupes de 1 à 4 mots, 2 lignes au plus.
// ---------------------------------------------------------------------------

/** Nombre de lignes du groupe, retour à la ligne entre les mots, MAX_LINE_CHARS par ligne. */
export function lineCount(texts: readonly string[], maxLineChars = MAX_LINE_CHARS): number {
  let lines = 0;
  let current: number | null = null;
  for (const text of texts) {
    if (current !== null && current + 1 + text.length <= maxLineChars) {
      current += 1 + text.length;
    } else {
      lines += 1;
      current = text.length;
    }
  }
  return lines;
}

function mustBreak(group: readonly SpokenWord[], previous: SpokenWord, next: SpokenWord): boolean {
  if (CLAUSE_END.test(previous.text)) return true;
  if (next.startS - previous.endS >= PAUSE_S) return true;
  if (group.length >= MAX_WORDS_PER_GROUP) return true;
  return lineCount([...group, next].map((word) => word.text)) > MAX_LINES;
}

export function groupWords(words: readonly SpokenWord[]): SpokenWord[][] {
  const groups: SpokenWord[][] = [];
  let current: SpokenWord[] = [];
  for (const word of words) {
    const previous = current.at(-1);
    if (previous && mustBreak(current, previous, word)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// ---------------------------------------------------------------------------
// Entrées de la piste : une par mot, calées sur l'image (30 i/s).
// ---------------------------------------------------------------------------

/** Le mot mis en évidence, sans la ponctuation qui l'entoure. */
export function activeWord(text: string): string {
  const stripped = text.replace(EDGE_PUNCTUATION, "");
  return stripped === "" ? text : stripped;
}

function cue(text: string, word: SpokenWord, endS: number, lastFrame: number): SubtitleCue {
  const startFrame = Math.min(frameOf(word.startS), lastFrame - 1);
  const endFrame = Math.min(Math.max(frameOf(endS), startFrame + 1), lastFrame);
  return { mots: text, debut_s: secondsOf(startFrame), fin_s: secondsOf(endFrame), mot_actif: activeWord(word.text) };
}

function groupCues(group: readonly SpokenWord[], nextStartS: number | null, videoEndS: number): SubtitleCue[] {
  const last = group.at(-1);
  if (!last) return [];
  const text = group.map((word) => word.text).join(" ");
  const groupEndS = Math.min(last.endS + HOLD_S, nextStartS ?? Number.POSITIVE_INFINITY, videoEndS);
  const lastFrame = frameOf(videoEndS);
  return group.map((word, index) => cue(text, word, group[index + 1]?.startS ?? groupEndS, lastFrame));
}

/**
 * Piste sous_titres complète : chaque groupe s'affiche du début de son premier mot jusqu'à peu après son dernier,
 * avec une entrée par mot (le mot actif change, le groupe reste). Rien ne dépasse la fin de la vidéo.
 */
export function buildSubtitles(words: readonly SpokenWord[], videoEndS: number): SubtitleCue[] {
  const groups = groupWords(words);
  return groups.flatMap((group, index) => groupCues(group, groups[index + 1]?.[0]?.startS ?? null, videoEndS));
}
