import type { Dossier } from "./variables";
import type { Beat } from "./rules";
import type { Output } from "./schema";

// Données d'exemple pour les tests de l'agent 4 (aucun appel réel au modèle).

/** Bible minimale : 20 à 30 s, donc 25 s visées ; 2 mots/s, donc 50 mots (48 à 52 avec la tolérance de 5 %). */
export const TEST_BIBLE = `chaine:
  nom: "Objets"
  niche: "objets du quotidien"
  promesse: "comprendre ce qu'on utilise"
ligne_editoriale:
  ton: "curieux"
  tutoiement: true
  piliers: ["histoire des objets"]
  sujets_interdits: ["politique"]
format_video:
  duree_cible_s: [20, 30]
  debit_voix_mots_par_s: 2
identite:
  voix: "moteur / voix"
  cta: "Abonne-toi pour la suite"
`;

export const IDEA = { id: "I-07", angle: "Le trombone n'a pas été inventé par qui on croit", revelation: "brevet de 1899" };

export function makeDossier(): Dossier {
  const fact = (id: string, confiance: Dossier["faits"][number]["confiance"], url: string) => ({
    id,
    fait: `Fait ${id} sur le trombone.`,
    source: { titre: "Brevet US 636272", auteur: "USPTO", date: "1899-11-07", url },
    type_source: "primaire" as const,
    confiance,
    formulation_prudente: `Formulation prudente de ${id}.`,
  });
  return {
    idee_id: "I-07",
    verdict: "ok",
    faits: [fact("F1", "eleve", "https://example.org/f1"), fact("F2", "moyen", "https://example.org/f2"), fact("F3", "faible", "source à trouver")],
    detail_accroche: "Le modèle actuel date de 1899.",
    idee_recue: "Le trombone serait norvégien.",
    erreurs_frequentes: [],
    points_sensibles: [],
    angle_de_remplacement: null,
  };
}

/** 6 + 10 + 14 + 14 + 6 = 50 mots, de 0 à 25 s. */
export function makeBeats(): Beat[] {
  return [
    { n: 1, role: "accroche", debut_s: 0, fin_s: 3, voix: "Ton trombone cache un secret industriel.", texte_ecran: "Un secret industriel", faits: [], intention_visuelle: "Gros plan sur un trombone" },
    { n: 2, role: "contexte", debut_s: 3, fin_s: 8, voix: "Tu en utilises des dizaines sans jamais vraiment y penser.", texte_ecran: "Des dizaines par jour", faits: [], intention_visuelle: "Bureau encombré" },
    {
      n: 3,
      role: "revelation",
      debut_s: 8,
      fin_s: 15,
      voix: "En 1899, un brevet américain décrit sa forme actuelle. Personne ne s'en souvient aujourd'hui.",
      texte_ecran: "1899 : le vrai brevet",
      faits: ["F1"],
      intention_visuelle: "Page de brevet ancienne",
    },
    {
      n: 4,
      role: "chute",
      debut_s: 15,
      fin_s: 22,
      voix: "Le Norvégien qu'on célèbre n'a jamais fabriqué ce modèle. Son brevet était très différent.",
      texte_ecran: "Pas le Norvégien",
      faits: ["F2"],
      intention_visuelle: "Deux schémas côte à côte",
    },
    { n: 5, role: "boucle", debut_s: 22, fin_s: 25, voix: "Alors, qui a inventé ton trombone ?", texte_ecran: "Qui l'a inventé ?", faits: [], intention_visuelle: "Retour au gros plan" },
  ];
}

export function makeScript(overrides: Partial<Output> = {}): Output {
  return {
    idee_id: "I-07",
    titre_interne: "Le vrai inventeur du trombone",
    accroches: [
      { type: "affirmation", voix: "Ton trombone cache un secret industriel.", texte_ecran: "Un secret industriel" },
      { type: "question", voix: "Qui a vraiment inventé le trombone ?", texte_ecran: "Qui l'a inventé ?" },
      { type: "situation", voix: "Tu attaches deux feuilles. Ce geste a une histoire cachée.", texte_ecran: "Une histoire cachée" },
    ],
    beats: makeBeats(),
    nb_mots: 50,
    duree_estimee_s: 25,
    cta: null,
    verifications: { accroche_sans_son: true, faits_tous_sources: true, duree_ok: true },
    ...overrides,
  };
}

/** Remplace un beat (repéré par son numéro) du script d'exemple. */
export function withBeat(n: number, changes: Partial<Beat>, script: Output = makeScript()): Output {
  return { ...script, beats: script.beats.map((beat) => (beat.n === n ? { ...beat, ...changes } : beat)) };
}
