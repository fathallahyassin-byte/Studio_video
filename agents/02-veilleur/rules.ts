import type { ControlResult } from "@/agents/_shared/types";
import type { Output } from "./schema";
import { findSimilarTitle, normalizeText, titleSimilarity } from "./similarity";

// Recalculs et refus faits en code, sans base ni réseau : testables tels quels.

export type Idea = Output["idees"][number];
export type Notes = Idea["notes"];

/** Ce que le code sait de la veille en cours, lu avant l'appel au modèle. */
export type ScoutContext = {
  /** semaine ISO de la veille, ex. « 2026-W47 » (le prompt ne donne pas la date au modèle) */
  week: string;
  /** false : aucun signal fourni, toutes les idées sont des hypothèses */
  hasSignals: boolean;
  /** false : aucun enseignement de l'analyste, donc pas de bonus possible */
  hasLearnings: boolean;
  /** titres des vidéos de la chaîne des 90 derniers jours */
  backlogTitles: string[];
  /** piliers de la bible ; vide si la bible ne les donne pas encore */
  pillars: string[];
  sujetsInterdits: string[];
};

export const LEARNING_BONUS = 0.5;
export const SIMILARITY_PENALTY = 1;
/** Aucun pilier au-dessus de 40 % des idées. */
export const MAX_PILLAR_SHARE = 0.4;
export const EXPECTED_SERIES = 3;
/** Deux idées de la même veille au-delà de ce seuil donneraient la même vidéo. */
export const DUPLICATE_IDEA_THRESHOLD = 0.75;

export function averageNote(notes: Notes): number {
  const values = [notes.accroche, notes.interet, notes.originalite, notes.faisabilite_visuelle, notes.verifiabilite];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Ajustements possibles du modèle : on retient le plus proche de l'écart entre son score et la moyenne. */
const CLAIMS = [
  { delta: 0, bonus: false, penalty: false },
  { delta: LEARNING_BONUS, bonus: true, penalty: false },
  { delta: -SIMILARITY_PENALTY, bonus: false, penalty: true },
  { delta: LEARNING_BONUS - SIMILARITY_PENALTY, bonus: true, penalty: true },
] as const;

/** Bonus et pénalité que le modèle a appliqués, déduits de son score. */
export function claimedAdjustments(modelScore: number, average: number): { bonus: boolean; penalty: boolean } {
  const delta = modelScore - average;
  const nearest = CLAIMS.reduce((best, claim) => (Math.abs(claim.delta - delta) < Math.abs(best.delta - delta) ? claim : best));
  return { bonus: nearest.bonus, penalty: nearest.penalty };
}

/**
 * Score = moyenne des 5 notes, +0,5 si l'idée exploite un enseignement de l'analyste, −1 si elle ressemble
 * à une idée déjà produite. Le bonus n'est accordé que si l'analyste a donné des enseignements ; la pénalité
 * s'applique si le modèle l'a vue OU si le code trouve un titre proche.
 */
export function recomputeScore(idea: Idea, context: Pick<ScoutContext, "hasLearnings" | "backlogTitles">): number {
  const average = averageNote(idea.notes);
  const claimed = claimedAdjustments(idea.score, average);
  const bonus = claimed.bonus && context.hasLearnings ? LEARNING_BONUS : 0;
  const tooClose = claimed.penalty || findSimilarTitle(idea.angle, context.backlogTitles) !== null;
  return round1(average + bonus - (tooClose ? SIMILARITY_PENALTY : 0));
}

/** Semaine fixée par le code, score recalculé, hypothèse forcée sans signaux, tri par score décroissant. */
export function normalizeScout(output: Output, context: ScoutContext): Output {
  const idees = output.idees
    .map((idea) => ({ ...idea, score: recomputeScore(idea, context), hypothese: context.hasSignals ? idea.hypothese : true }))
    .sort((a, b) => b.score - a.score);
  return { ...output, semaine: context.week, idees };
}

// ---------------------------------------------------------------------------
// Contrôles : chaque refus est renvoyé au modèle, qui corrige sa sortie.
// ---------------------------------------------------------------------------

const ok: ControlResult = { ok: true };
const refuse = (reason: string): ControlResult => ({ ok: false, reason });

export function checkUniqueIds(output: Output): ControlResult {
  const ids = output.idees.map((idea) => idea.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  return duplicates.length === 0 ? ok : refuse(`Identifiants d'idée en double : ${duplicates.join(", ")}.`);
}

export function checkPillarShare(output: Output): ControlResult {
  const counts = new Map<string, { label: string; count: number }>();
  for (const idea of output.idees) {
    const key = normalizeText(idea.pilier);
    const entry = counts.get(key) ?? { label: idea.pilier, count: 0 };
    counts.set(key, { ...entry, count: entry.count + 1 });
  }
  const limit = Math.floor(output.idees.length * MAX_PILLAR_SHARE);
  const over = [...counts.values()].filter((entry) => entry.count > limit);
  if (over.length === 0) return ok;
  return refuse(`Aucun pilier ne doit dépasser 40 % des idées (${limit} sur ${output.idees.length}) : ${over.map((entry) => `« ${entry.label} » en a ${entry.count}`).join(", ")}.`);
}

/** Les piliers doivent venir de la bible, quand elle les donne (les {{PILIER_N}} du modèle de bible ne comptent pas). */
export function checkPillarsFromBible(output: Output, pillars: readonly string[]): ControlResult {
  const known = pillars.filter((pillar) => !pillar.includes("{{")).map(normalizeText);
  if (known.length === 0) return ok;
  const unknown = [...new Set(output.idees.map((idea) => idea.pilier).filter((pillar) => !known.includes(normalizeText(pillar))))];
  if (unknown.length === 0) return ok;
  return refuse(`Piliers absents de la bible : ${unknown.map((pillar) => `« ${pillar} »`).join(", ")}. Utilise uniquement : ${pillars.join(", ")}.`);
}

export function checkSeriesCount(output: Output): ControlResult {
  return output.series.length === EXPECTED_SERIES ? ok : refuse(`Propose exactement ${EXPECTED_SERIES} séries (reçu : ${output.series.length}).`);
}

/** « Jamais deux idées qui donneraient la même vidéo avec d'autres mots. » */
export function checkNoDuplicateIdeas(output: Output): ControlResult {
  const pairs: string[] = [];
  output.idees.forEach((idea, index) => {
    for (const other of output.idees.slice(index + 1)) {
      if (titleSimilarity(idea.angle, other.angle) >= DUPLICATE_IDEA_THRESHOLD) pairs.push(`${idea.id} et ${other.id}`);
    }
  });
  return pairs.length === 0 ? ok : refuse(`Idées en double (même vidéo avec d'autres mots) : ${pairs.join(" ; ")}. Remplace l'une de chaque paire.`);
}

/** Un sujet interdit de la bible cité mot pour mot dans l'idée. */
export function findForbiddenSubject(idea: Idea, sujetsInterdits: readonly string[]): string | null {
  const text = ` ${normalizeText([idea.pilier, idea.angle, idea.accroche, idea.revelation].join(" "))} `;
  return sujetsInterdits.find((subject) => {
    const phrase = normalizeText(subject);
    return phrase !== "" && text.includes(` ${phrase} `);
  }) ?? null;
}

export function checkForbiddenSubjects(output: Output, sujetsInterdits: readonly string[]): ControlResult {
  const hits = output.idees.flatMap((idea) => {
    const subject = findForbiddenSubject(idea, sujetsInterdits);
    return subject === null ? [] : [`${idea.id} (« ${subject} »)`];
  });
  return hits.length === 0 ? ok : refuse(`Sujets interdits par la bible : ${hits.join(", ")}.`);
}

export function scoutControls(output: Output, context: Pick<ScoutContext, "pillars" | "sujetsInterdits">): ControlResult[] {
  return [
    checkUniqueIds(output),
    checkPillarShare(output),
    checkPillarsFromBible(output, context.pillars),
    checkSeriesCount(output),
    checkNoDuplicateIdeas(output),
    checkForbiddenSubjects(output, context.sujetsInterdits),
  ];
}
