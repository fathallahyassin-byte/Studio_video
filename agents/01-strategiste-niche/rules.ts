import { isMap, isScalar, parseDocument } from "yaml";
import type { ControlResult } from "@/agents/_shared/types";
import { checkBible } from "@/lib/bible/bible";
import type { StrategyPayload } from "./payload";
import type { Output } from "./schema";
import { CRITERION_KEYS, nicheKey, weightedScore, type Candidate } from "./scoring";

// Contrôles en code, tirés du prompt. Chaque refus est renvoyé au modèle dans la relance.

export const MIN_PISTES_WITHOUT_COMPLETION = 8;
export const COMPLETED_CANDIDATES = 12;
export const TITLES_PER_NICHE = 10;
export const ACCOUNTS_TO_STUDY = 3;
export const TEST_PLAN = { videos: 20, weeks: 4 } as const;

export type StrategyContext = { payload: StrategyPayload; bibleTemplate: string };

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });
const isBlank = (text: string) => text.trim() === "";

export function checkStrategy(output: Output, context: StrategyContext): ControlResult[] {
  return [
    checkUniqueNiches(output.candidates),
    checkCandidateCount(output.candidates, context.payload),
    checkJustifications(output.candidates),
    checkTop3(output),
    checkTitles(output.top3),
    checkAccountsToStudy(output.top3),
    checkRecommendation(output),
    checkTestPlan(output.plan_de_test),
    checkProposedBible(output.bible, context.bibleTemplate),
  ];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    const key = nicheKey(value);
    if (seen.has(key)) repeated.add(value.trim());
    seen.add(key);
  }
  return [...repeated];
}

export function checkUniqueNiches(candidates: readonly Candidate[]): ControlResult {
  const blank = candidates.filter((candidate) => [candidate.niche, candidate.public, candidate.angle].some(isBlank)).length;
  if (blank > 0) return fail(`${blank} niche(s) candidate(s) sans nom, public ou angle.`);
  const repeated = duplicates(candidates.map((candidate) => candidate.niche));
  return repeated.length === 0 ? ok : fail(`Niches candidates en double : ${repeated.join(", ")}.`);
}

/** Étape 1 : moins de 8 pistes fournies → compléter jusqu'à 12 candidates. */
export function checkCandidateCount(candidates: readonly Candidate[], payload: StrategyPayload): ControlResult {
  if (payload.pistes.length >= MIN_PISTES_WITHOUT_COMPLETION || candidates.length >= COMPLETED_CANDIDATES) return ok;
  return fail(
    `${payload.pistes.length} piste(s) fournie(s), moins de ${MIN_PISTES_WITHOUT_COMPLETION} : il faut ${COMPLETED_CANDIDATES} niches candidates, pas ${candidates.length}.`,
  );
}

export function checkJustifications(candidates: readonly Candidate[]): ControlResult {
  const missing = candidates.flatMap((candidate) =>
    CRITERION_KEYS.filter((key) => isBlank(candidate.criteres[key].pourquoi)).map((key) => `${candidate.niche.trim()} (${key})`),
  );
  return missing.length === 0 ? ok : fail(`Notes sans justification : ${missing.join(", ")}.`);
}

/** Étape 4 : les 3 meilleures au score recalculé (une égalité avec la 3ᵉ est acceptée). */
export function checkTop3(output: Output): ControlResult {
  const scores = new Map(output.candidates.map((candidate) => [nicheKey(candidate.niche), weightedScore(candidate.criteres)]));
  const repeated = duplicates(output.top3.map((entry) => entry.niche));
  if (repeated.length > 0) return fail(`Top 3 en double : ${repeated.join(", ")}.`);
  const unknown = output.top3.filter((entry) => !scores.has(nicheKey(entry.niche))).map((entry) => entry.niche.trim());
  if (unknown.length > 0) return fail(`Top 3 hors des candidates : ${unknown.join(", ")}.`);
  const threshold = [...scores.values()].sort((a, b) => b - a)[2] ?? 0;
  const below = output.top3.filter((entry) => (scores.get(nicheKey(entry.niche)) ?? 0) < threshold);
  if (below.length === 0) return ok;
  const list = below.map((entry) => `${entry.niche.trim()} (${scores.get(nicheKey(entry.niche))})`).join(", ");
  return fail(`Le top 3 doit reprendre les 3 meilleurs scores pondérés (recalculés en code, 3ᵉ score : ${threshold}) : ${list} en dessous.`);
}

export function checkTitles(top3: Output["top3"]): ControlResult {
  const problems = top3.flatMap((entry) => {
    const titles = entry.exemples_titres.filter((title) => !isBlank(title));
    const distinct = new Set(titles.map(nicheKey)).size;
    return distinct === TITLES_PER_NICHE ? [] : [`${entry.niche.trim()} : ${distinct} titre(s) distinct(s) non vide(s)`];
  });
  return problems.length === 0 ? ok : fail(`Il faut ${TITLES_PER_NICHE} titres d'exemple distincts par niche du top 3 — ${problems.join(" ; ")}.`);
}

export function checkAccountsToStudy(top3: Output["top3"]): ControlResult {
  const problems = top3.filter((entry) => entry.a_etudier.filter((item) => !isBlank(item)).length !== ACCOUNTS_TO_STUDY).map((entry) => entry.niche.trim());
  if (problems.length === 0) return ok;
  return fail(`Il faut ${ACCOUNTS_TO_STUDY} comptes ou formats à étudier (« à vérifier » sans source) pour : ${problems.join(", ")}.`);
}

export function checkRecommendation(output: Output): ControlResult {
  const { recommandation } = output;
  if (!output.top3.some((entry) => nicheKey(entry.niche) === nicheKey(recommandation.niche))) {
    return fail(`La niche recommandée (« ${recommandation.niche.trim()} ») doit faire partie du top 3.`);
  }
  if (isBlank(recommandation.pourquoi)) return fail("La recommandation n'explique pas pourquoi.");
  const risks = recommandation.risques.filter((risk) => !isBlank(risk));
  return risks.length > 0 ? ok : fail("La recommandation doit lister au moins un risque.");
}

/** Étape 6 : 20 vidéos en 4 semaines, critère chiffré. */
export function checkTestPlan(plan: Output["plan_de_test"]): ControlResult {
  if (plan.nb_videos !== TEST_PLAN.videos || plan.semaines !== TEST_PLAN.weeks) {
    return fail(`Le plan de test doit prévoir ${TEST_PLAN.videos} vidéos en ${TEST_PLAN.weeks} semaines (reçu : ${plan.nb_videos} en ${plan.semaines}).`);
  }
  return /\d/.test(plan.critere_validation) ? ok : fail("Le critère de validation du plan de test doit être chiffré.");
}

/** Étape 5 : bible complète, lisible par les agents, au format du modèle, sans {{…}} restant. */
export function checkProposedBible(bible: string, template: string): ControlResult {
  const check = checkBible(bible);
  if (!check.ok) return fail(`Bible proposée refusée : ${check.error}.`);
  if (check.placeholders.length > 0) {
    return fail(`Bible proposée incomplète, champs du modèle non remplis : ${check.placeholders.map((name) => `{{${name}}}`).join(", ")}.`);
  }
  const missing = missingTemplateKeys(bible, template);
  return missing.length === 0 ? ok : fail(`Bible proposée hors du format du modèle, clés absentes : ${missing.join(", ")}.`);
}

/** Clés du modèle (2 niveaux : « chaine », « chaine.nom »…) absentes du YAML proposé. */
export function missingTemplateKeys(yamlText: string, template: string): string[] {
  const present = new Set(keyPaths(yamlText));
  return keyPaths(template).filter((key) => !present.has(key));
}

function mapKeys(node: unknown): string[] {
  if (!isMap(node)) return [];
  return node.items.flatMap((pair) => (isScalar(pair.key) ? [String(pair.key.value)] : []));
}

function keyPaths(yamlText: string): string[] {
  const root = parseDocument(yamlText).contents;
  if (!isMap(root)) return [];
  return root.items.flatMap((pair) => {
    if (!isScalar(pair.key)) return [];
    const parent = String(pair.key.value);
    return [parent, ...mapKeys(pair.value).map((child) => `${parent}.${child}`)];
  });
}
