import type { Output } from "./schema";

// Score pondéré recalculé en code (prompt, étape 3) : celui du modèle est ignoré.

export type Candidate = Output["candidates"][number];
export type Criteria = Candidate["criteres"];
export type CriterionKey = keyof Criteria;

export const WEIGHTS: Readonly<Record<CriterionKey, number>> = {
  demande: 2,
  faisabilite_ia: 2,
  profondeur: 2,
  monetisation: 1.5,
  risque: 1.5,
  differenciation: 1.5,
  concurrence: 1,
};

/** Ordre d'affichage : celui des critères dans le prompt (étape 2). */
export const CRITERION_KEYS: readonly CriterionKey[] = ["demande", "concurrence", "monetisation", "faisabilite_ia", "profondeur", "risque", "differenciation"];

/** 5 partout : 57,5 */
export const MAX_SCORE = CRITERION_KEYS.reduce((total, key) => total + 5 * WEIGHTS[key], 0);

export function weightedScore(criteria: Criteria): number {
  return CRITERION_KEYS.reduce((total, key) => total + criteria[key].note * WEIGHTS[key], 0);
}

/** Remplace le score du modèle par le score recalculé, puis trie du meilleur au moins bon (ordre du modèle à égalité). */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .map((candidate, index) => ({ candidate: { ...candidate, score_pondere: weightedScore(candidate.criteres) }, index }))
    .sort((a, b) => b.candidate.score_pondere - a.candidate.score_pondere || a.index - b.index)
    .map(({ candidate }) => candidate);
}

export function normalizeStrategy(output: Output): Output {
  return { ...output, candidates: rankCandidates(output.candidates) };
}

/** Comparaison des noms de niches : casse, espaces et accents composés ignorés. */
export function nicheKey(niche: string): string {
  return niche.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}
