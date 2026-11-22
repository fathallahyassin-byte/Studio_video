import type { ChipTone } from "@/components/ui";
import type { Stage } from "@/lib/generated/prisma/client";
import { hasUsableSource, type Confidence, type Fact } from "../rules";
import { outputSchema, type Output } from "../schema";

// Modèle de vue du panneau : données sérialisables, calculées côté serveur (fonctions pures).

export type DossierRow = {
  id: string;
  label: string;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  updatedLabel: string;
  dossierJson: unknown;
};

export type FactView = {
  id: string;
  fait: string;
  formulationPrudente: string;
  typeSource: Fact["type_source"];
  sourceText: string;
  /** null quand la source reste à trouver : rien à cliquer */
  href: string | null;
};

export type FactGroup = { confidence: Confidence; title: string; facts: FactView[] };

export type DossierView = {
  videoId: string;
  label: string;
  title: string;
  updatedLabel: string;
  verdict: Output["verdict"];
  /** bloquée par le recherchiste, en attente de l'humain */
  awaitingFix: boolean;
  weakCount: number;
  groups: FactGroup[];
  detailAccroche: string;
  ideeRecue: string;
  erreursFrequentes: string[];
  pointsSensibles: string[];
  angleDeRemplacement: string | null;
};

export const verdictDisplay: Record<Output["verdict"], { label: string; tone: ChipTone }> = {
  ok: { label: "OK", tone: "ok" },
  ok_avec_reserves: { label: "OK avec réserves", tone: "run" },
  angle_a_changer: { label: "Angle à changer", tone: "run" },
};

const confidenceTitles: Record<Confidence, string> = {
  eleve: "Confiance élevée",
  moyen: "Confiance moyenne",
  faible: "Confiance faible · interdit dans le script",
};

const CONFIDENCE_ORDER: readonly Confidence[] = ["eleve", "moyen", "faible"];

export function sourceHref(url: string): string | null {
  return hasUsableSource(url) ? url.trim() : null;
}

function describeSource(source: Fact["source"]): string {
  const parts = [source.titre, source.auteur, source.date].map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? "Source à trouver" : parts.join(" · ");
}

function toFactView(fact: Fact): FactView {
  return {
    id: fact.id,
    fait: fact.fait,
    formulationPrudente: fact.formulation_prudente,
    typeSource: fact.type_source,
    sourceText: describeSource(fact.source),
    href: sourceHref(fact.source.url),
  };
}

/** Faits groupés par niveau de confiance, du plus sûr au plus fragile ; les groupes vides sont omis. */
export function groupFactsByConfidence(facts: readonly Fact[]): FactGroup[] {
  return CONFIDENCE_ORDER.map((confidence) => ({
    confidence,
    title: confidenceTitles[confidence],
    facts: facts.filter((fact) => fact.confiance === confidence).map(toFactView),
  })).filter((group) => group.facts.length > 0);
}

/** null si le dossier enregistré est illisible (schéma changé, donnée abîmée). */
export function toDossierView(row: DossierRow): DossierView | null {
  const parsed = outputSchema.safeParse(row.dossierJson);
  if (!parsed.success) return null;
  const dossier = parsed.data;
  return {
    videoId: row.id,
    label: row.label,
    title: row.title,
    updatedLabel: row.updatedLabel,
    verdict: dossier.verdict,
    awaitingFix: row.stage === "NEEDS_FIX" && row.blockedAt === "RESEARCH",
    weakCount: dossier.faits.filter((fact) => fact.confiance === "faible").length,
    groups: groupFactsByConfidence(dossier.faits),
    detailAccroche: dossier.detail_accroche,
    ideeRecue: dossier.idee_recue,
    erreursFrequentes: dossier.erreurs_frequentes,
    pointsSensibles: dossier.points_sensibles,
    angleDeRemplacement: dossier.angle_de_remplacement?.trim() || null,
  };
}

/** Filtre « faits faibles » : les dossiers à compléter. */
export function filterDossiers(dossiers: readonly DossierView[], onlyWeak: boolean): DossierView[] {
  return onlyWeak ? dossiers.filter((dossier) => dossier.weakCount > 0) : [...dossiers];
}
