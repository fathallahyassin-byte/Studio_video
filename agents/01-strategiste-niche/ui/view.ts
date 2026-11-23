import type { ChipTone } from "@/components/ui";
import { strategyPayloadSchema } from "../payload";
import { outputSchema, type Output } from "../schema";
import { CRITERION_KEYS, MAX_SCORE, nicheKey, rankCandidates, WEIGHTS, type CriterionKey } from "../scoring";
import { countChanges, diffLines, type DiffLine } from "./diff";

// Modèle de vue du panneau (fonctions pures, testées) : données sérialisables pour les composants.

export const CRITERION_LABELS: Readonly<Record<CriterionKey, { label: string; short: string }>> = {
  demande: { label: "Demande", short: "Dem." },
  concurrence: { label: "Concurrence", short: "Conc." },
  monetisation: { label: "Monétisation", short: "Mon." },
  faisabilite_ia: { label: "Faisabilité IA", short: "IA" },
  profondeur: { label: "Profondeur", short: "Prof." },
  risque: { label: "Risque", short: "Risq." },
  differenciation: { label: "Différenciation", short: "Diff." },
};

const scoreFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const weightFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function formatScore(score: number): string {
  return scoreFormat.format(score);
}

export type CriterionColumn = { key: CriterionKey; label: string; short: string; weightLabel: string };

export const CRITERION_COLUMNS: readonly CriterionColumn[] = CRITERION_KEYS.map((key) => ({
  key,
  ...CRITERION_LABELS[key],
  weightLabel: `×${weightFormat.format(WEIGHTS[key])}`,
}));

export type NoteView = { key: CriterionKey; label: string; note: number; why: string };

export type CandidateView = {
  rank: number;
  niche: string;
  audience: string;
  angle: string;
  scoreLabel: string;
  inTop3: boolean;
  recommended: boolean;
  notes: NoteView[];
};

export type Top3View = { niche: string; scoreLabel: string; recommended: boolean; titles: string[]; toStudy: string[] };

export type StrategyView = {
  candidates: CandidateView[];
  top3: Top3View[];
  recommendation: { niche: string; why: string; risks: string[] };
  plan: { summary: string; criterion: string };
  maxScoreLabel: string;
};

/** Lecture tolérante d'une sortie enregistrée : null si elle ne respecte plus le schéma. */
export function parseStoredStrategy(value: unknown): Output | null {
  const parsed = outputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Scores recalculés et tri refaits ici aussi : l'affichage ne dépend jamais du score du modèle. */
export function toStrategyView(output: Output): StrategyView {
  const ranked = rankCandidates(output.candidates);
  const top3Keys = new Set(output.top3.map((entry) => nicheKey(entry.niche)));
  const recommendedKey = nicheKey(output.recommandation.niche);
  const scores = new Map(ranked.map((candidate) => [nicheKey(candidate.niche), candidate.score_pondere]));

  return {
    candidates: ranked.map((candidate, index) => ({
      rank: index + 1,
      niche: candidate.niche,
      audience: candidate.public,
      angle: candidate.angle,
      scoreLabel: formatScore(candidate.score_pondere),
      inTop3: top3Keys.has(nicheKey(candidate.niche)),
      recommended: nicheKey(candidate.niche) === recommendedKey,
      notes: CRITERION_KEYS.map((key) => ({ key, label: CRITERION_LABELS[key].label, note: candidate.criteres[key].note, why: candidate.criteres[key].pourquoi })),
    })),
    top3: [...output.top3]
      .sort((a, b) => (scores.get(nicheKey(b.niche)) ?? 0) - (scores.get(nicheKey(a.niche)) ?? 0))
      .map((entry) => ({
        niche: entry.niche,
        scoreLabel: formatScore(scores.get(nicheKey(entry.niche)) ?? 0),
        recommended: nicheKey(entry.niche) === recommendedKey,
        titles: entry.exemples_titres,
        toStudy: entry.a_etudier,
      })),
    recommendation: { niche: output.recommandation.niche, why: output.recommandation.pourquoi, risks: output.recommandation.risques },
    plan: { summary: `${output.plan_de_test.nb_videos} vidéos en ${output.plan_de_test.semaines} semaines`, criterion: output.plan_de_test.critere_validation },
    maxScoreLabel: formatScore(MAX_SCORE),
  };
}

// ---------------------------------------------------------------------------
// Bible proposée, comparée à la bible active.
// ---------------------------------------------------------------------------

export type BibleRef = { id: string; version: number };

export type BibleDraftView = {
  /** `pending` : brouillon à adopter (attend l'humain) ; `active` : déjà adopté ; `missing` : pas encore enregistré */
  status: "pending" | "active" | "missing";
  draft: BibleRef | null;
  activeVersion: number | null;
  lines: DiffLine[];
  added: number;
  removed: number;
};

export function toBibleDraftView(input: { proposed: string; draft: BibleRef | null; active: (BibleRef & { content: string }) | null }): BibleDraftView {
  const lines = diffLines(input.active?.content ?? "", input.proposed);
  const status = input.draft === null ? "missing" : input.draft.id === input.active?.id ? "active" : "pending";
  return { status, draft: input.draft, activeVersion: input.active?.version ?? null, lines, ...countChanges(lines) };
}

// ---------------------------------------------------------------------------
// Formulaire pré-rempli et état de la dernière tâche.
// ---------------------------------------------------------------------------

export type FormDefaults = { pistes: string; heuresParSemaine: string; budgetMensuel: string; objectifRevenus: string; refus: string };

export const EMPTY_FORM: FormDefaults = { pistes: "", heuresParSemaine: "", budgetMensuel: "", objectifRevenus: "", refus: "" };

/** Reprend les réponses de la dernière analyse (payload de la dernière tâche), sinon un formulaire vide. */
export function toFormDefaults(payload: unknown): FormDefaults {
  const parsed = strategyPayloadSchema.safeParse(payload);
  if (!parsed.success) return EMPTY_FORM;
  const { pistes, heuresParSemaine, budgetMensuel, objectifRevenus, refus } = parsed.data;
  return { pistes: pistes.join("\n"), heuresParSemaine: String(heuresParSemaine), budgetMensuel: String(budgetMensuel), objectifRevenus, refus: refus.join("\n") };
}

export type JobState = { status: "QUEUED" | "RUNNING" | "DONE" | "FAILED"; jobKey: string; lastError: string | null };

export type JobStatusView = { label: string; tone: ChipTone; message: string };

/** État de la dernière tâche, seulement s'il dit autre chose que le résultat affiché. */
export function toJobStatus(job: JobState | null, latestResultJobKey: string | null): JobStatusView | null {
  if (!job) return null;
  const detail = job.lastError ? ` Dernier message : ${job.lastError}` : "";
  switch (job.status) {
    case "QUEUED":
      return { label: "En file", tone: "run", message: `Analyse en attente du worker.${detail}` };
    case "RUNNING":
      return { label: "En cours", tone: "run", message: "Le stratège note les niches et rédige la bible (quelques minutes)." };
    case "FAILED":
      return { label: "Échec", tone: "wait", message: `L'analyse a été abandonnée : relance-la.${detail}` };
    case "DONE":
      if (job.jobKey === latestResultJobKey) return null;
      return { label: "Sans résultat", tone: "wait", message: `La dernière analyse n'a pas produit de sortie valide après 3 essais.${detail}` };
  }
}
