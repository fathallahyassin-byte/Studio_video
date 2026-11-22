import { countWords } from "@/agents/04-scenariste/rules";
import type { ControlResult } from "@/agents/_shared/types";
import type { Output } from "./schema";

// Règles de l'agent 6 appliquées en code (fonctions pures) : recalculs, refus renvoyés au modèle,
// durée estimée de la voix et application des coupes proposées.

export type Effect = Output["effets"][number];
export type Direction = Output["direction_par_beat"][number];

/** Prompt : « Effets sonores : 4 à 8 ». Le maximum est aussi dans schema.ts. */
export const EFFECTS_COUNT = { min: 4, max: 8 } as const;
/** Prompt : « musique 18 à 22 dB sous la voix ». */
export const MUSIC_UNDER_VOICE_DB = { min: -22, max: -18 } as const;
/** Prompt : « mix final autour de −14 LUFS intégrés » (format_video.loudness_lufs de la bible s'il existe). */
export const DEFAULT_LUFS = -14;
/** Un effet est calé sur une transition : on tolère ce décalage autour du plan (ou du beat) annoncé. */
export const EFFECT_TOLERANCE_S = 0.25;
/** Le texte TTS adapte la voix sans la raccourcir : au moins 85 % des mots du script (les coupes vont à part). */
export const MIN_TEXT_RATIO = 0.85;
/** Tempo plausible pour une musique de fond. */
export const BPM_RANGE = { min: 40, max: 220 } as const;

export { countWords };

export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Balises du moteur TTS : <break time="0.5s"/>, </emphasis>, [pause]…
// ---------------------------------------------------------------------------

const TAG_PATTERN = /<[^<>]*>|\[[^[\]]*\]/g;

export function extractTags(text: string): string[] {
  return text.match(TAG_PATTERN) ?? [];
}

/** Ce qui est prononcé : le texte sans les balises. */
export function spokenText(text: string): string {
  return text.replace(TAG_PATTERN, " ").replace(/\s+/g, " ").trim();
}

/** Nom d'une balise ou d'une balise déclarée par le moteur : « <break time="1s"/> » → « break », « [pause] » → « pause ». */
export function tagName(tag: string): string {
  const inner = tag.trim().replace(/^[<[]\/?/, "").replace(/\/?[>\]]$/, "").trim();
  return (inner.split(/[\s=]/)[0] ?? "").toLowerCase();
}

export function spokenWords(text: string): number {
  return countWords(spokenText(text));
}

/** Durée de la voix d'après le débit de la bible (mots par seconde). */
export function estimateVoiceS(text: string, wordsPerSecond: number): number {
  return roundTenth(spokenWords(text) / wordsPerSecond);
}

// ---------------------------------------------------------------------------
// normalize : valeurs fixées par le prompt, listes triées et nettoyées.
// ---------------------------------------------------------------------------

export type NormalizeSettings = { loudnessLufs: number };

export function normalizeAudioPlan(output: Output, settings: NormalizeSettings): Output {
  return {
    ...output,
    idee_id: output.idee_id.trim(),
    texte_tts: output.texte_tts.trim(),
    prononciations: uniqueBy(
      output.prononciations.map((entry) => ({ mot: entry.mot.trim(), phonetique: entry.phonetique.trim() })),
      (entry) => entry.mot.toLowerCase(),
    ),
    direction_par_beat: [...output.direction_par_beat].sort((a, b) => a.beat - b.beat),
    musique: { ...output.musique, mots_cles_recherche: cleanList(output.musique.mots_cles_recherche), instruments: cleanList(output.musique.instruments) },
    effets: [...output.effets].map((effect) => ({ ...effect, plan: effect.plan.trim(), effet: effect.effet.trim() })).sort((a, b) => a.t_s - b.t_s),
    // « musique 18 à 22 dB sous la voix » : un écart positif est lu comme un écart sous la voix.
    mixage: { cible_lufs: settings.loudnessLufs, musique_sous_voix_db: -Math.abs(output.mixage.musique_sous_voix_db), ducking: true },
    coupes_si_trop_long: cleanList(output.coupes_si_trop_long),
  };
}

function cleanList(values: readonly string[]): string[] {
  return uniqueBy(
    values.map((value) => value.trim()).filter((value) => value !== ""),
    (value) => value.toLowerCase(),
  );
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Coupes : chaque coupe est un passage exact de texte_tts, retiré en code si la voix est trop longue.
// ---------------------------------------------------------------------------

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

export function isExcerpt(text: string, cut: string): boolean {
  return collapse(cut) !== "" && collapse(text).includes(collapse(cut));
}

/** Retire un passage et répare la ponctuation laissée autour (« , . » → « . », espaces doubles). */
export function removeExcerpt(text: string, cut: string): string {
  return collapse(collapse(text).replace(collapse(cut), " "))
    .replace(/\s+([,.…])/g, "$1")
    .replace(/[,;:]\s*([.!?…])/g, "$1")
    .replace(/^[\s,;:.…]+/, "")
    .trim();
}

export type CutPlan = { text: string; applied: string[]; estimatedS: number; reached: boolean };

/**
 * Applique les coupes dans l'ordre proposé jusqu'à passer sous maxS. La durée après coupe est estimée
 * au débit mesuré (durée réelle ÷ mots prononcés) : c'est elle qui compte, pas le débit théorique.
 */
export function planCuts(text: string, cuts: readonly string[], measure: { durationS: number; maxS: number }): CutPlan {
  const rate = measure.durationS / Math.max(spokenWords(text), 1);
  const estimate = (value: string) => roundTenth(rate * spokenWords(value));
  let current = text;
  const applied: string[] = [];
  for (const cut of cuts) {
    if (estimate(current) <= measure.maxS) break;
    if (!isExcerpt(current, cut)) continue;
    current = removeExcerpt(current, cut);
    applied.push(cut);
  }
  const estimatedS = estimate(current);
  return { text: current, applied, estimatedS, reached: estimatedS <= measure.maxS };
}

export type DurationTarget = { minS: number; maxS: number };
export type DurationVerdict = "ok" | "too_long" | "too_short";

export function durationVerdict(durationS: number, target: DurationTarget): DurationVerdict {
  if (durationS > target.maxS) return "too_long";
  if (durationS < target.minS) return "too_short";
  return "ok";
}

// ---------------------------------------------------------------------------
// Contrôles : chaque refus est renvoyé au modèle.
// ---------------------------------------------------------------------------

export type TimeSpan = { debut_s: number; fin_s: number };

/** Ce que les contrôles comparent au plan sonore : le script validé, le storyboard s'il existe, la bible, le moteur. */
export type AudioContext = {
  ideaId: string;
  beats: readonly (TimeSpan & { n: number })[];
  scriptEndS: number;
  /** mots de la voix des beats du script */
  scriptWords: number;
  /** plans du storyboard ; null s'il n'existe pas encore (les effets visent alors les beats : B1, B2…) */
  plans: readonly (TimeSpan & { id: string })[] | null;
  target: DurationTarget & { wordsPerSecond: number };
  /** noms des balises acceptées ; null si aucun moteur TTS n'est branché (aucune balise permise) */
  ttsTags: readonly string[] | null;
};

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });

export function checkAudioPlan(output: Output, context: AudioContext): ControlResult[] {
  return [
    checkIdeaId(output, context.ideaId),
    checkDirections(output, context.beats),
    ...checkTtsText(output.texte_tts, context.ttsTags),
    checkTextLength(output, context.scriptWords),
    checkPronunciations(output),
    checkEmphasis(output),
    ...checkEffects(output.effets, context),
    ...checkMusic(output),
    checkMix(output),
    ...checkCuts(output, context.target),
  ];
}

export function checkIdeaId(output: Output, ideaId: string): ControlResult {
  return output.idee_id.trim() === ideaId.trim() ? ok : fail(`idee_id vaut « ${output.idee_id} » : reprends celui du script, « ${ideaId} ».`);
}

/** Une direction par beat du script, ni plus ni moins. */
export function checkDirections(output: Output, beats: readonly { n: number }[]): ControlResult {
  const expected = beats.map((beat) => beat.n);
  const received = output.direction_par_beat.map((direction) => direction.beat);
  const missing = expected.filter((n) => !received.includes(n));
  const unknown = received.filter((n) => !expected.includes(n));
  const duplicates = received.filter((n, index) => received.indexOf(n) !== index);
  const problems = [
    missing.length > 0 ? `beats sans direction : ${missing.join(", ")}` : null,
    unknown.length > 0 ? `beats absents du script : ${unknown.join(", ")}` : null,
    duplicates.length > 0 ? `beats en double : ${[...new Set(duplicates)].join(", ")}` : null,
  ].filter((problem) => problem !== null);
  return problems.length === 0 ? ok : fail(`direction_par_beat : ${problems.join(" ; ")} (une entrée par beat du script, de 1 à ${Math.max(...expected)}).`);
}

/** Nombres écrits en toutes lettres ; balises du moteur seulement (aucune sans moteur). */
export function checkTtsText(text: string, ttsTags: readonly string[] | null): ControlResult[] {
  const digits = spokenText(text).match(/\S*\d\S*/g) ?? [];
  const allowed = new Set((ttsTags ?? []).map(tagName));
  const refused = [...new Set(extractTags(text).filter((tag) => !allowed.has(tagName(tag))))];
  return [
    digits.length === 0 ? ok : fail(`texte_tts contient des chiffres (${[...new Set(digits)].join(", ")}) : écris-les comme ils se prononcent.`),
    refused.length === 0
      ? ok
      : fail(
          ttsTags === null
            ? `texte_tts contient des balises (${refused.join(", ")}) alors qu'aucun moteur n'en accepte : marque les pauses par la ponctuation.`
            : `Balises non acceptées par le moteur : ${refused.join(", ")}. Balises permises : ${ttsTags.join(", ") || "aucune"}.`,
        ),
  ];
}

export function checkTextLength(output: Output, scriptWords: number): ControlResult {
  const words = spokenWords(output.texte_tts);
  const minimum = Math.floor(scriptWords * MIN_TEXT_RATIO);
  if (words >= minimum) return ok;
  return fail(`texte_tts compte ${words} mots pour ${scriptWords} dans la voix du script : adapte sans couper (au moins ${minimum} mots). Les coupes vont dans coupes_si_trop_long.`);
}

export function checkPronunciations(output: Output): ControlResult {
  const empty = output.prononciations.filter((entry) => entry.mot === "" || entry.phonetique === "");
  if (empty.length === 0) return ok;
  return fail(`prononciations incomplètes (mot ou graphie phonétique vide) : ${empty.map((entry) => entry.mot || "(mot vide)").join(", ")}.`);
}

const simplify = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");

export function checkEmphasis(output: Output): ControlResult {
  const text = simplify(spokenText(output.texte_tts));
  const absent = output.direction_par_beat.flatMap((direction) =>
    direction.mots_appuyes.filter((word) => word.trim() !== "" && !text.includes(simplify(word.trim()))).map((word) => `« ${word} » (beat ${direction.beat})`),
  );
  return absent.length === 0 ? ok : fail(`Mots à appuyer absents de texte_tts : ${absent.join(", ")}.`);
}

export function checkEffects(effects: readonly Effect[], context: AudioContext): ControlResult[] {
  const count =
    effects.length >= EFFECTS_COUNT.min && effects.length <= EFFECTS_COUNT.max
      ? ok
      : fail(`${effects.length} effets sonores : il en faut de ${EFFECTS_COUNT.min} à ${EFFECTS_COUNT.max}.`);
  return [count, ...effects.map((effect) => checkEffect(effect, context))];
}

function checkEffect(effect: Effect, context: AudioContext): ControlResult {
  if (effect.t_s > context.scriptEndS + EFFECT_TOLERANCE_S) return fail(`Effet « ${effect.effet} » à ${effect.t_s} s, après la fin du script (${context.scriptEndS} s).`);
  const span = findSpan(effect.plan, context);
  if (!span) return fail(unknownSpanReason(effect, context));
  if (effect.t_s < span.debut_s - EFFECT_TOLERANCE_S || effect.t_s > span.fin_s + EFFECT_TOLERANCE_S) {
    return fail(`Effet « ${effect.effet} » à ${effect.t_s} s, hors de ${effect.plan} (${span.debut_s} à ${span.fin_s} s).`);
  }
  return ok;
}

function findSpan(reference: string, context: AudioContext): TimeSpan | null {
  if (context.plans) return context.plans.find((plan) => plan.id === reference) ?? null;
  const beat = /^B(\d+)$/i.exec(reference);
  return beat ? (context.beats.find((entry) => entry.n === Number(beat[1])) ?? null) : null;
}

function unknownSpanReason(effect: Effect, context: AudioContext): string {
  if (context.plans) return `Effet « ${effect.effet} » : le plan ${effect.plan} n'existe pas dans le storyboard (${context.plans.map((plan) => plan.id).join(", ")}).`;
  return `Effet « ${effect.effet} » : « ${effect.plan} » ne désigne aucun beat. Sans storyboard, écris B1, B2… (numéro du beat).`;
}

export function checkMusic(output: Output): ControlResult[] {
  const { musique } = output;
  return [
    simplify(musique.licence_requise).includes("commercial")
      ? ok
      : fail(`musique.licence_requise doit exiger l'usage commercial sur TikTok, Instagram et YouTube (reçu : « ${musique.licence_requise} »).`),
    musique.mots_cles_recherche.length > 0 ? ok : fail("musique.mots_cles_recherche est vide : donne des mots-clés pour la bibliothèque libre de droits."),
    musique.bpm >= BPM_RANGE.min && musique.bpm <= BPM_RANGE.max ? ok : fail(`musique.bpm vaut ${musique.bpm} : un tempo entre ${BPM_RANGE.min} et ${BPM_RANGE.max}.`),
  ];
}

export function checkMix(output: Output): ControlResult {
  const db = output.mixage.musique_sous_voix_db;
  if (db >= MUSIC_UNDER_VOICE_DB.min && db <= MUSIC_UNDER_VOICE_DB.max) return ok;
  return fail(`mixage.musique_sous_voix_db vaut ${db} : la musique reste de 18 à 22 dB sous la voix (entre ${MUSIC_UNDER_VOICE_DB.min} et ${MUSIC_UNDER_VOICE_DB.max}).`);
}

/** Coupes applicables en code (passages exacts du texte) ; obligatoires et suffisantes si la voix estimée dépasse la cible. */
export function checkCuts(output: Output, target: AudioContext["target"]): ControlResult[] {
  const notFound = output.coupes_si_trop_long.filter((cut) => !isExcerpt(output.texte_tts, cut));
  const results: ControlResult[] = [
    notFound.length === 0 ? ok : fail(`Coupes introuvables dans texte_tts : ${notFound.map((cut) => `« ${cut} »`).join(", ")}. Chaque coupe recopie exactement un passage à supprimer.`),
  ];
  const estimatedS = estimateVoiceS(output.texte_tts, target.wordsPerSecond);
  if (estimatedS <= target.maxS) return results;
  if (output.coupes_si_trop_long.length === 0) {
    return [...results, fail(`Voix estimée à ${estimatedS} s (${target.wordsPerSecond} mots/s) pour ${target.maxS} s au plus : propose des coupes dans coupes_si_trop_long.`)];
  }
  const plan = planCuts(output.texte_tts, output.coupes_si_trop_long, { durationS: estimatedS, maxS: target.maxS });
  return plan.reached ? results : [...results, fail(`Même avec toutes les coupes, la voix est estimée à ${plan.estimatedS} s pour ${target.maxS} s au plus : propose des coupes plus longues.`)];
}
