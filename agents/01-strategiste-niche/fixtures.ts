import { readFileSync } from "node:fs";
import path from "node:path";
import type { StrategyPayload } from "./payload";
import type { Output } from "./schema";
import type { Candidate, Criteria } from "./scoring";

// Données de test (tests uniquement) : une sortie valide de l'agent 1 et le modèle de bible du dépôt.

export const BIBLE_TEMPLATE = readFileSync(path.join(import.meta.dirname, "..", "..", "docs", "bible.template.yaml"), "utf8").replace(/\r\n/g, "\n");

const TEMPLATE_VALUES: Record<string, string> = {
  NOM: "Objets bavards",
  NICHE: "l'histoire cachée des objets du quotidien",
  PROMESSE: "Regarder autrement un objet banal en une minute",
  PERSONA: "curieux de 18 à 35 ans",
  TON: "complice et précis",
  CTA: "Abonne-toi pour l'objet de demain",
};

/** Le modèle du dépôt, chaque {{VARIABLE}} remplacée : une bible complète au format exact. */
export function fillTemplate(overrides: Readonly<Record<string, string>> = {}): string {
  const values: Record<string, string> = { ...TEMPLATE_VALUES, ...overrides };
  return BIBLE_TEMPLATE.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_match, name: string) => values[name] ?? `valeur ${name.toLowerCase()}`);
}

export const PAYLOAD: StrategyPayload = {
  pistes: ["histoire des objets", "inventions ratées"],
  heuresParSemaine: 6,
  budgetMensuel: 80,
  objectifRevenus: "500 € par mois dans 12 mois",
  refus: ["montrer mon visage", "parler de politique"],
};

type Notes = [demande: number, concurrence: number, monetisation: number, faisabilite: number, profondeur: number, risque: number, differenciation: number];

export function criteria(notes: Notes): Criteria {
  const [demande, concurrence, monetisation, faisabilite_ia, profondeur, risque, differenciation] = notes;
  const entry = (note: number) => ({ note, pourquoi: `note ${note}, à vérifier` });
  return {
    demande: entry(demande),
    concurrence: entry(concurrence),
    monetisation: entry(monetisation),
    faisabilite_ia: entry(faisabilite_ia),
    profondeur: entry(profondeur),
    risque: entry(risque),
    differenciation: entry(differenciation),
  };
}

export function candidate(niche: string, notes: Notes, scorePondere = 0): Candidate {
  return { niche, public: `public de ${niche}`, angle: `angle de ${niche}`, criteres: criteria(notes), score_pondere: scorePondere };
}

/** 12 candidates, volontairement dans le désordre ; le score du modèle (99) est faux. */
export const CANDIDATES: Candidate[] = [
  candidate("Inventions ratées", [4, 4, 3, 5, 4, 5, 4], 99), // 48
  candidate("Histoire cachée des objets", [5, 3, 4, 5, 5, 5, 4], 99), // 52.5
  candidate("Records de la nature", [4, 2, 3, 4, 4, 5, 3], 99), // 42.5
  candidate("Mots et expressions", [4, 3, 3, 5, 5, 5, 4], 99), // 49
  candidate("Métiers disparus", [3, 4, 3, 4, 4, 5, 4], 99), // 44
  candidate("Physique du quotidien", [4, 3, 3, 4, 5, 5, 3], 99), // 45.5
  candidate("Cartes et frontières", [3, 3, 2, 4, 4, 3, 3], 99), // 37
  candidate("Mythes de la cuisine", [4, 2, 4, 4, 4, 3, 3], 99), // 41
  candidate("Architecture insolite", [3, 3, 3, 4, 4, 5, 3], 99), // 41.5
  candidate("Animaux et inventions", [3, 3, 3, 4, 3, 5, 4], 99), // 41
  candidate("Logos et couleurs", [3, 3, 3, 3, 3, 4, 3], 99), // 36
  candidate("Petites lois absurdes", [3, 4, 2, 4, 3, 3, 4], 99), // 37.5
];

const titles = (niche: string) => Array.from({ length: 10 }, (_, index) => `${niche} : titre ${index + 1}`);

export function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    candidates: CANDIDATES,
    top3: ["Histoire cachée des objets", "Mots et expressions", "Inventions ratées"].map((niche) => ({
      niche,
      exemples_titres: titles(niche),
      a_etudier: ["compte à vérifier 1", "format à vérifier 2", "compte à vérifier 3"],
    })),
    recommandation: { niche: "Histoire cachée des objets", pourquoi: "Demande durable et visuels faciles.", risques: ["Sujets proches de la concurrence"] },
    plan_de_test: { nb_videos: 20, semaines: 4, critere_validation: "40 % de visionnage complet sur 10 vidéos" },
    bible: fillTemplate(),
    ...overrides,
  };
}
