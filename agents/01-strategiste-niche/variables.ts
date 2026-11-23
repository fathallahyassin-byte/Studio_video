import type { StrategyPayload } from "./payload";

// Texte des {{VARIABLES}} du prompt. Une entrée vide devient une phrase explicite.

export const NO_PISTES = "aucune piste fournie : propose toi-même 12 niches candidates.";
export const NO_REFUS = "rien de précisé";
export const LANGUE = "français (fr-FR), public francophone";

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** {{PISTES_NICHES}} : une piste par ligne, ou la phrase NO_PISTES. */
export function formatPistes(pistes: readonly string[]): string {
  if (pistes.length === 0) return NO_PISTES;
  return [`${pistes.length} piste(s) :`, ...pistes.map((piste) => `- ${piste}`)].join("\n");
}

/** {{CONTRAINTES}} : temps, budget, langue, refus. */
export function formatContraintes(payload: StrategyPayload): string {
  const refus = payload.refus.length === 0 ? NO_REFUS : payload.refus.join(" ; ");
  return [
    `- Temps disponible : ${numberFormat.format(payload.heuresParSemaine)} h par semaine`,
    `- Budget mensuel : ${numberFormat.format(payload.budgetMensuel)} € (outils et générations IA compris)`,
    `- Langue : ${LANGUE}`,
    `- Ce que je refuse de faire : ${refus}`,
  ].join("\n");
}

export function buildStrategyVariables(payload: StrategyPayload, bibleTemplate: string): Record<string, string> {
  return {
    PISTES_NICHES: formatPistes(payload.pistes),
    CONTRAINTES: formatContraintes(payload),
    OBJECTIF_MONETISATION: payload.objectifRevenus,
    MODELE_BIBLE: bibleTemplate,
  };
}
