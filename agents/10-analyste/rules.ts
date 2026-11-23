import type { ControlResult } from "@/agents/_shared/types";
import type { Output } from "./schema";
import type { AnalysisSnapshot } from "./snapshot";
import type { RunningExperiment } from "./variables";

// Règles du prompt appliquées en code : recalculs (normalize) puis refus renvoyés au modèle (controls).

export const MIN_STRONG_EVIDENCE = 5;
export const LEARNINGS_RANGE = { min: 3, max: 5 } as const;
export const EXPERIMENTS_COUNT = 2;
export const MAX_SUMMARY_LINES = 3;
export const MAX_BIBLE_UPDATES = 5;
export const MAX_BIBLE_LINE = 300;
/** tolérance d'arrondi sur un pourcentage cité */
export const PERCENT_TOLERANCE = 1;

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function uniqueLines(lines: readonly string[]): string[] {
  return [...new Set(lines.map(clean).filter((line) => line !== ""))];
}

/** Période fixée en code, confiance « faible » sous 5 vidéos, listes nettoyées. */
export function normalizeReport(output: Output, snapshot: Pick<AnalysisSnapshot, "period">): Output {
  return {
    ...output,
    periode: snapshot.period,
    resume: output.resume.trim(),
    top: output.top.map((entry) => ({ video_id: entry.video_id.trim(), pourquoi: entry.pourquoi.trim() })),
    flop: output.flop.map((entry) => ({ video_id: entry.video_id.trim(), pourquoi: entry.pourquoi.trim() })),
    enseignements: output.enseignements.map((learning) => ({
      ...learning,
      confiance: learning.nb_videos < MIN_STRONG_EVIDENCE ? "faible" : learning.confiance,
    })),
    maj_bible: uniqueLines(output.maj_bible),
    maj_backlog: {
      prioriser: uniqueLines(output.maj_backlog.prioriser),
      abandonner: uniqueLines(output.maj_backlog.abandonner),
      series: uniqueLines(output.maj_backlog.series),
    },
  };
}

export function checkReport(output: Output, snapshot: AnalysisSnapshot, running: readonly RunningExperiment[]): ControlResult[] {
  return [
    checkSummary(output),
    ...checkRanking(output, snapshot),
    checkLearnings(output, snapshot.ranking.length),
    checkCitedPercents(output, snapshot.allowedPercents),
    ...checkExperiments(output, running),
    checkBibleUpdates(output),
    output.justification.trim() === "" ? fail("La justification du verdict sur la niche est vide.") : ok,
  ];
}

function checkSummary(output: Output): ControlResult {
  const lines = output.resume.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return fail("Le résumé est vide.");
  return lines.length > MAX_SUMMARY_LINES ? fail(`Le résumé fait ${lines.length} lignes : ${MAX_SUMMARY_LINES} au maximum.`) : ok;
}

/** Top et flop : vidéos comparables (plus de 72 h), nombre attendu, aucun doublon, top au-dessus du flop. */
export function checkRanking(output: Output, snapshot: AnalysisSnapshot): ControlResult[] {
  const results = [
    checkIds("top", output.top, snapshot),
    checkIds("flop", output.flop, snapshot),
    checkCount("top", output.top.length, snapshot.expected.top),
    checkCount("flop", output.flop.length, snapshot.expected.flop),
    checkOverlap(output),
  ];
  return results.every((result) => result.ok) ? [checkOrder(output, snapshot)] : results;
}

function checkIds(list: "top" | "flop", entries: Output["top"], snapshot: AnalysisSnapshot): ControlResult {
  const comparable = new Set(snapshot.ranking.map((score) => score.videoId));
  const known = new Set(snapshot.rows.map((row) => row.sample.videoId));
  const recent = entries.filter((entry) => known.has(entry.video_id) && !comparable.has(entry.video_id)).map((entry) => entry.video_id);
  const unknown = entries.filter((entry) => !known.has(entry.video_id)).map((entry) => entry.video_id);
  if (unknown.length > 0) return fail(`${list} : video_id inconnu(s) ${unknown.join(", ")} ; reprends les video_id de « classement ».`);
  if (recent.length > 0) return fail(`${list} : ${recent.join(", ")} exclue(s) des comparaisons (moins de 72 h ou sans relevé).`);
  const duplicates = entries.length - new Set(entries.map((entry) => entry.video_id)).size;
  return duplicates > 0 ? fail(`${list} : une même vidéo apparaît plusieurs fois.`) : ok;
}

function checkCount(list: "top" | "flop", actual: number, expected: number): ControlResult {
  return actual === expected ? ok : fail(`${list} : ${expected} vidéo(s) attendue(s) d'après le classement, ${actual} reçue(s).`);
}

function checkOverlap(output: Output): ControlResult {
  const top = new Set(output.top.map((entry) => entry.video_id));
  const both = output.flop.filter((entry) => top.has(entry.video_id)).map((entry) => entry.video_id);
  return both.length > 0 ? fail(`Vidéo(s) à la fois dans le top et le flop : ${both.join(", ")}.`) : ok;
}

/** Chaque vidéo du top a un indice au moins égal à celui de chaque vidéo du flop. */
function checkOrder(output: Output, snapshot: AnalysisSnapshot): ControlResult {
  const indexOf = new Map(snapshot.ranking.map((score) => [score.videoId, score.index]));
  const lowestTop = Math.min(...output.top.map((entry) => indexOf.get(entry.video_id) ?? 1));
  const highestFlop = Math.max(...output.flop.map((entry) => indexOf.get(entry.video_id) ?? 1));
  if (output.flop.length === 0 || lowestTop >= highestFlop) return ok;
  return fail("Le top contient une vidéo moins bien classée qu'une vidéo du flop : suis l'ordre de « classement ».");
}

function checkLearnings(output: Output, comparable: number): ControlResult {
  const count = output.enseignements.length;
  if (count < LEARNINGS_RANGE.min || count > LEARNINGS_RANGE.max) {
    return fail(`${count} enseignement(s) : il en faut de ${LEARNINGS_RANGE.min} à ${LEARNINGS_RANGE.max}.`);
  }
  const unsupported = output.enseignements.filter((learning) => learning.nb_videos < 1 || learning.nb_videos > comparable);
  if (unsupported.length === 0) return ok;
  return fail(`nb_videos doit être compris entre 1 et ${comparable} (vidéos comparables) : « ${unsupported[0]?.observation ?? ""} ».`);
}

/** Pourcentages cités dans un texte (« +15 % », « 41% », « 12,5 % »), en valeur absolue. */
export function extractPercents(text: string): number[] {
  return [...text.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)].map((match) => Math.abs(Number((match[1] ?? "").replace(",", "."))));
}

/** Les pourcentages cités (résumé, top/flop, observations) doivent figurer dans les données calculées. */
export function checkCitedPercents(output: Output, allowed: readonly number[]): ControlResult {
  const texts = [output.resume, ...output.top.map((entry) => entry.pourquoi), ...output.flop.map((entry) => entry.pourquoi), ...output.enseignements.map((learning) => learning.observation)];
  const invented = [...new Set(texts.flatMap(extractPercents))].filter((value) => !allowed.some((known) => Math.abs(known - value) <= PERCENT_TOLERANCE));
  if (invented.length === 0) return ok;
  return fail(`Pourcentage(s) absent(s) des données calculées : ${invented.map((value) => `${value} %`).join(", ")}. Cite uniquement les écarts et taux fournis dans les statistiques, sans calcul.`);
}

/** Une seule variable : pas de « et », « + », virgule ni barre oblique. */
export function isSingleVariable(variable: string): boolean {
  const text = variable.trim();
  return text !== "" && !/\s(et|and)\s|[+,;/&]/i.test(text);
}

const sameVariable = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();

export function checkExperiments(output: Output, running: readonly RunningExperiment[]): ControlResult[] {
  const { experiences } = output;
  if (experiences.length !== EXPERIMENTS_COUNT) return [fail(`${experiences.length} expérience(s) : il en faut exactement ${EXPERIMENTS_COUNT}.`)];
  const results = experiences.map((experiment, position): ControlResult => {
    const label = `Expérience ${position + 1}`;
    if (!isSingleVariable(experiment.variable)) return fail(`${label} : une seule variable changée (« ${experiment.variable} »).`);
    if (!/\d/.test(experiment.critere_reussite)) return fail(`${label} : le critère de réussite doit être chiffré.`);
    const busy = running.find((current) => sameVariable(current.variable, experiment.variable));
    return busy ? fail(`${label} : la variable « ${experiment.variable} » est déjà testée par une expérience en cours.`) : ok;
  });
  const [first, second] = experiences;
  const distinct = first && second && sameVariable(first.variable, second.variable) ? fail("Les deux expériences changent la même variable.") : ok;
  return [...results, distinct];
}

function checkBibleUpdates(output: Output): ControlResult {
  if (output.maj_bible.length > MAX_BIBLE_UPDATES) return fail(`maj_bible : ${MAX_BIBLE_UPDATES} lignes au maximum.`);
  const tooLong = output.maj_bible.find((line) => line.length > MAX_BIBLE_LINE);
  return tooLong ? fail(`maj_bible : une ligne dépasse ${MAX_BIBLE_LINE} caractères (une phrase actionnable par ligne).`) : ok;
}
