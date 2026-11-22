import type { ControlResult } from "@/agents/_shared/types";
import type { Output } from "./schema";

// Règles de l'agent 4 appliquées en code : fonctions pures, testées dans rules.test.ts.

export type Beat = Output["beats"][number];
export type Role = Beat["role"];
export type Confidence = "eleve" | "moyen" | "faible";

/** Ce que la bible impose au script : durée visée (milieu de duree_cible_s), bornes et débit de la voix. */
export type ScriptTarget = {
  durationS: number;
  minDurationS: number;
  maxDurationS: number;
  wordsPerSecond: number;
};

/** « Nombre de mots = durée × débit de la bible, à 5 % près. » */
export const WORD_TOLERANCE = 0.05;
/** « 12 mots maximum par phrase. » */
export const MAX_WORDS_PER_SENTENCE = 12;
/** « Texte écran : 3 à 6 mots par beat. » */
export const SCREEN_TEXT_WORDS = { min: 3, max: 6 } as const;
/** « ACCROCHE (0 à 3 s) » */
export const HOOK_MAX_END_S = 3;
/** « 3 révélations maximum » */
export const MAX_REVELATIONS = 3;
/** Écart toléré entre la fin d'un beat et le début du suivant (arrondis du modèle). */
export const TIME_EPSILON_S = 0.05;

const ROLE_ORDER: readonly Role[] = ["accroche", "contexte", "revelation", "chute", "boucle"];
const FORBIDDEN_OPENINGS = ["salut", "dans cette video", "le saviez-vous", "le saviez vous"];

// ---------------------------------------------------------------------------
// Comptage des mots et de la durée.
// ---------------------------------------------------------------------------

/** Un mot = un groupe sans espace qui contient au moins une lettre ou un chiffre (« — » et « … » ne comptent pas). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Mots réellement prononcés : la voix de tous les beats. */
export function countScriptWords(beats: readonly Pick<Beat, "voix">[]): number {
  return beats.reduce((total, beat) => total + countWords(beat.voix), 0);
}

export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function estimateDurationS(words: number, wordsPerSecond: number): number {
  return roundTenth(words / wordsPerSecond);
}

export function targetWords(target: ScriptTarget): number {
  return target.durationS * target.wordsPerSecond;
}

export function wordBounds(target: ScriptTarget): { min: number; max: number } {
  const words = targetWords(target);
  return { min: Math.ceil(words * (1 - WORD_TOLERANCE)), max: Math.floor(words * (1 + WORD_TOLERANCE)) };
}

export function isWordCountOk(words: number, target: ScriptTarget): boolean {
  const bounds = wordBounds(target);
  return words >= bounds.min && words <= bounds.max;
}

// ---------------------------------------------------------------------------
// normalize : les compteurs sont recalculés en code, jamais repris du modèle.
// ---------------------------------------------------------------------------

export type FactIndex = ReadonlyMap<string, Confidence>;

export function normalizeScript(output: Output, target: ScriptTarget, facts: FactIndex): Output {
  const words = countScriptWords(output.beats);
  return {
    ...output,
    nb_mots: words,
    duree_estimee_s: estimateDurationS(words, target.wordsPerSecond),
    verifications: {
      ...output.verifications,
      faits_tous_sources: findFactProblems(output.beats, facts).length === 0,
      duree_ok: isWordCountOk(words, target),
    },
  };
}

// ---------------------------------------------------------------------------
// Contrôles en code : chaque refus est renvoyé au modèle pour correction.
// ---------------------------------------------------------------------------

const passed: ControlResult = { ok: true };
const refuse = (reason: string): ControlResult => ({ ok: false, reason });

type FactProblem = { beat: number; factId: string; kind: "inconnu" | "faible" };

function findFactProblems(beats: readonly Beat[], facts: FactIndex): FactProblem[] {
  return beats.flatMap((beat) =>
    beat.faits.flatMap((factId): FactProblem[] => {
      const confidence = facts.get(factId.trim());
      if (confidence === undefined) return [{ beat: beat.n, factId, kind: "inconnu" }];
      if (confidence === "faible") return [{ beat: beat.n, factId, kind: "faible" }];
      return [];
    }),
  );
}

export function checkFacts(output: Output, facts: FactIndex): ControlResult[] {
  const problems = findFactProblems(output.beats, facts);
  const unknown = problems.filter((problem) => problem.kind === "inconnu");
  const weak = problems.filter((problem) => problem.kind === "faible");
  const describe = (list: FactProblem[]) => list.map((problem) => `${problem.factId} (beat ${problem.beat})`).join(", ");
  const known = [...facts.keys()].join(", ") || "aucun";
  return [
    unknown.length === 0 ? passed : refuse(`Faits absents du dossier : ${describe(unknown)}. Ids disponibles : ${known}. Cite uniquement un id du dossier.`),
    weak.length === 0 ? passed : refuse(`Faits de confiance « faible » interdits : ${describe(weak)}. Retire l'affirmation ou appuie-la sur un fait « eleve » ou « moyen ».`),
  ];
}

export function checkWordCount(output: Output, target: ScriptTarget): ControlResult {
  const words = countScriptWords(output.beats);
  if (isWordCountOk(words, target)) return passed;
  const bounds = wordBounds(target);
  const goal = Math.round(targetWords(target));
  const action = words < bounds.min ? `ajoute environ ${goal - words} mots` : `retire environ ${words - goal} mots`;
  return refuse(
    `La voix des beats compte ${words} mots (recomptés en code). Cible : ${target.durationS} s × ${target.wordsPerSecond} mots/s ≈ ${goal} mots, à 5 % près, soit entre ${bounds.min} et ${bounds.max} : ${action}.`,
  );
}

/** Beats numérotés 1, 2, 3…, de 0 s à la fin, sans trou ni chevauchement, dans la durée cible. */
export function checkTimeline(output: Output, target: ScriptTarget): ControlResult {
  const problems = timelineProblems(output.beats);
  const end = output.beats.at(-1)?.fin_s ?? 0;
  if (end < target.minDurationS - TIME_EPSILON_S || end > target.maxDurationS + TIME_EPSILON_S) {
    problems.push(`la frise se termine à ${end} s, hors de la durée cible (${target.minDurationS} à ${target.maxDurationS} s)`);
  }
  return problems.length === 0 ? passed : refuse(`Frise des beats incohérente : ${problems.join(" ; ")}.`);
}

function timelineProblems(beats: readonly Beat[]): string[] {
  const problems: string[] = [];
  beats.forEach((beat, index) => {
    if (beat.n !== index + 1) problems.push(`le beat en position ${index + 1} porte le numéro ${beat.n}`);
    if (beat.fin_s <= beat.debut_s) problems.push(`le beat ${beat.n} finit (${beat.fin_s} s) avant de commencer (${beat.debut_s} s)`);
    const expectedStart = index === 0 ? 0 : (beats[index - 1]?.fin_s ?? 0);
    const gap = beat.debut_s - expectedStart;
    if (gap > TIME_EPSILON_S) problems.push(`trou de ${roundTenth(gap)} s avant le beat ${beat.n}`);
    if (gap < -TIME_EPSILON_S) problems.push(`le beat ${beat.n} chevauche le précédent de ${roundTenth(-gap)} s`);
  });
  return problems;
}

/** Accroche (0 à 3 s), contexte, révélations (3 au plus), chute, boucle : dans cet ordre. */
export function checkStructure(output: Output): ControlResult {
  const roles = output.beats.map((beat) => beat.role);
  const problems: string[] = [];
  const first = output.beats[0];
  if (first?.role !== "accroche") problems.push("le premier beat doit être l'accroche");
  else if (first.fin_s > HOOK_MAX_END_S + TIME_EPSILON_S) problems.push(`l'accroche dure jusqu'à ${first.fin_s} s (3 s au plus)`);
  if (roles.filter((role) => role === "accroche").length > 1) problems.push("une seule accroche dans les beats");
  if (roles.at(-1) !== "boucle") problems.push("le dernier beat doit être la boucle");
  if (!roles.includes("chute")) problems.push("il manque la chute");
  const revelations = roles.filter((role) => role === "revelation").length;
  if (revelations > MAX_REVELATIONS) problems.push(`${revelations} révélations (${MAX_REVELATIONS} au plus)`);
  if (!isInRoleOrder(roles)) problems.push(`ordre attendu : ${ROLE_ORDER.join(" → ")} (reçu : ${roles.join(" → ")})`);
  return problems.length === 0 ? passed : refuse(`Structure du script : ${problems.join(" ; ")}.`);
}

function isInRoleOrder(roles: readonly Role[]): boolean {
  const ranks = roles.map((role) => ROLE_ORDER.indexOf(role));
  return ranks.every((rank, index) => index === 0 || rank >= (ranks[index - 1] ?? 0));
}

/** Phrases d'un texte parlé : coupées après . ! ? ou … suivis d'une espace. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => countWords(sentence) > 0);
}

export function checkSentenceLength(output: Output): ControlResult {
  const spoken = [
    ...output.accroches.map((hook, index) => ({ where: `accroche ${index + 1}`, text: hook.voix })),
    ...output.beats.map((beat) => ({ where: `beat ${beat.n}`, text: beat.voix })),
  ];
  const tooLong = spoken.flatMap(({ where, text }) =>
    splitSentences(text)
      .filter((sentence) => countWords(sentence) > MAX_WORDS_PER_SENTENCE)
      .map((sentence) => `${where} (${countWords(sentence)} mots : « ${sentence} »)`),
  );
  return tooLong.length === 0 ? passed : refuse(`Phrases de plus de ${MAX_WORDS_PER_SENTENCE} mots : ${tooLong.join(" ; ")}. Coupe-les.`);
}

export function checkScreenText(output: Output): ControlResult {
  const wrong = output.beats.filter((beat) => {
    const words = countWords(beat.texte_ecran);
    return words < SCREEN_TEXT_WORDS.min || words > SCREEN_TEXT_WORDS.max;
  });
  if (wrong.length === 0) return passed;
  const list = wrong.map((beat) => `beat ${beat.n} (${countWords(beat.texte_ecran)} mots)`).join(", ");
  return refuse(`Texte écran de ${SCREEN_TEXT_WORDS.min} à ${SCREEN_TEXT_WORDS.max} mots par beat : ${list}.`);
}

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function opensWithForbidden(text: string): boolean {
  const start = withoutAccents(text).replace(/^[^\p{L}\p{N}]+/u, "");
  return FORBIDDEN_OPENINGS.some((opening) => start.startsWith(opening));
}

/** 3 accroches de types différents, sans « Salut », « Dans cette vidéo » ni « Le saviez-vous ». */
export function checkHooks(output: Output): ControlResult {
  const problems: string[] = [];
  const types = output.accroches.map((hook) => hook.type);
  if (new Set(types).size !== types.length) problems.push(`les 3 accroches doivent être de types différents (reçu : ${types.join(", ")})`);
  const openings = [...output.accroches.map((hook) => hook.voix), output.beats[0]?.voix ?? ""];
  if (openings.some(opensWithForbidden)) problems.push("une accroche commence par « Salut », « Dans cette vidéo » ou « Le saviez-vous »");
  return problems.length === 0 ? passed : refuse(`Accroches : ${problems.join(" ; ")}.`);
}

export function checkIdeaId(output: Output, expectedIdeaId: string | null): ControlResult {
  if (expectedIdeaId === null || output.idee_id === expectedIdeaId) return passed;
  return refuse(`« idee_id » vaut « ${output.idee_id} » : reprends l'id de l'idée fournie, « ${expectedIdeaId} ».`);
}

export type ScriptContext = { target: ScriptTarget; facts: FactIndex; ideaId: string | null };

export function checkScript(output: Output, context: ScriptContext): ControlResult[] {
  return [
    ...checkFacts(output, context.facts),
    checkWordCount(output, context.target),
    checkTimeline(output, context.target),
    checkStructure(output),
    checkSentenceLength(output),
    checkScreenText(output),
    checkHooks(output),
    checkIdeaId(output, context.ideaId),
  ];
}
