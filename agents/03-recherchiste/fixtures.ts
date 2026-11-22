import type { Fact } from "./rules";
import type { Output } from "./schema";

// Dossiers d'exemple pour les tests de l'agent 3 (aucun appel réel au modèle).

export function makeFact(overrides: Partial<Fact> & { url?: string } = {}): Fact {
  const { url = "https://www.insee.fr/fr/statistiques/1234", ...rest } = overrides;
  return {
    id: "F1",
    fait: "Le trombone moderne a été breveté en 1899.",
    source: { titre: "Brevet US 636272", auteur: "USPTO", date: "1899-11-07", url },
    type_source: "primaire",
    confiance: "eleve",
    formulation_prudente: "Le modèle actuel du trombone date de la fin du XIXᵉ siècle.",
    ...rest,
  };
}

export function makeDossier(overrides: Partial<Output> = {}): Output {
  return {
    idee_id: "I-07",
    verdict: "ok",
    faits: [
      makeFact({ id: "F1" }),
      makeFact({ id: "F2", confiance: "moyen", type_source: "presse" }),
      makeFact({ id: "F3", type_source: "institutionnelle" }),
      makeFact({ id: "F4", confiance: "moyen", type_source: "encyclopedie" }),
      makeFact({ id: "F5", url: "source à trouver", confiance: "faible", type_source: "autre" }),
    ],
    detail_accroche: "Le trombone que tu utilises n'a jamais été breveté par son inventeur supposé.",
    idee_recue: "Le trombone serait une invention norvégienne.",
    erreurs_frequentes: ["Attribuer l'invention à Johan Vaaler sans nuance."],
    points_sensibles: [],
    angle_de_remplacement: null,
    ...overrides,
  };
}
