import type { VideoRecord } from "./metadata";
import type { Output } from "./schema";
import type { PlatformId, PublicationSample, StatValues } from "./stats";

// Données de test partagées : une chaîne avec quatre vidéos comparables et une vidéo trop récente.

/** Lundi 23 novembre 2026, 6 h (UTC) : semaine 2026-W48. */
export const NOW = new Date("2026-11-23T06:00:00Z");

const HOUR = 60 * 60 * 1000;

export const hoursBefore = (hours: number, from: Date = NOW) => new Date(from.getTime() - hours * HOUR);

export function makeStat(values: Partial<StatValues> = {}): StatValues {
  return { date: hoursBefore(24), views: 10_000, avgWatchTimeS: 30, completionRate: 0.4, shares: 100, saves: 100, followersGained: 20, ...values };
}

export function makeSample(videoId: string, platform: PlatformId, publishedHoursAgo: number | null, stat: Partial<StatValues> | null = {}): PublicationSample {
  return { videoId, platform, publishedAt: publishedHoursAgo === null ? null : hoursBefore(publishedHoursAgo), stat: stat === null ? null : makeStat(stat) };
}

/**
 * Classement attendu (indice décroissant) : v-a, v-b, v-c, v-d ; v-new a moins de 72 h.
 * TikTok : médiane des vues 10 000 et de la vue complète 40 %.
 */
export const SAMPLES: PublicationSample[] = [
  makeSample("v-a", "TIKTOK", 200, { views: 20_000, completionRate: 0.6 }),
  makeSample("v-b", "TIKTOK", 180, { views: 12_000, completionRate: 0.44 }),
  makeSample("v-c", "TIKTOK", 160, { views: 8_000, completionRate: 0.36 }),
  makeSample("v-d", "TIKTOK", 140, { views: 4_000, completionRate: 0.2 }),
  makeSample("v-new", "TIKTOK", 10, { views: 900_000, completionRate: 0.9 }),
];

export function makeVideo(id: string, number: number, overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id,
    number,
    title: `Vidéo ${id}`,
    idea: { pilier: number % 2 === 0 ? "Cuisine" : "Salle de bain", format: "révélation", accroche: "Et si…" },
    script: { accroches: [{ type: "question", voix: "Pourquoi ?" }], duree_estimee_s: 70 },
    storyboard: { plans: [{ type: "stock" }, { type: "image_ia_animee" }, { type: "image_ia_animee" }] },
    timeline: { duree_totale_s: 68 },
    publications: [{ platform: "TIKTOK", publishedAt: hoursBefore(150) }],
    promptVersions: [
      { agentId: 4, version: 2 },
      { agentId: 2, version: 1 },
    ],
    ...overrides,
  };
}

export const VIDEOS: VideoRecord[] = [makeVideo("v-a", 1), makeVideo("v-b", 2), makeVideo("v-c", 3), makeVideo("v-d", 4), makeVideo("v-new", 5)];

/** Sortie valide pour SAMPLES : top v-a, v-b ; flop v-d, v-c ; pourcentages présents dans les données. */
export function makeReport(overrides: Partial<Output> = {}): Output {
  return {
    periode: "semaine dernière",
    resume: "Quatre vidéos comparables sur TikTok.\nLes accroches en question tiennent mieux.",
    top: [
      { video_id: "v-a", pourquoi: "Vue complète à +50 % de la médiane" },
      { video_id: "v-b", pourquoi: "Au-dessus de la médiane" },
    ],
    flop: [
      { video_id: "v-d", pourquoi: "Vues à -60 % de la médiane" },
      { video_id: "v-c", pourquoi: "Sous la médiane" },
    ],
    enseignements: [
      { observation: "Le pilier Cuisine dépasse la médiane", nb_videos: 2, confiance: "moyenne", decision: "Garder la cuisine" },
      { observation: "Les vidéos de 60–75 s tiennent", nb_videos: 4, confiance: "faible", decision: "Rester sous 75 s" },
      { observation: "La vue complète médiane est de 40 %", nb_videos: 4, confiance: "faible", decision: "Viser 45 %" },
    ],
    experiences: [
      { hypothese: "Une vidéo plus courte est vue jusqu'au bout", variable: "durée", critere_reussite: "Vue complète +5 points sur 3 vidéos" },
      { hypothese: "Publier à 18 h donne plus de vues", variable: "créneau", critere_reussite: "Vues +20 % sur 2 semaines" },
    ],
    maj_bible: ["Les accroches en question retiennent mieux", "  Les accroches en question retiennent mieux  ", ""],
    maj_backlog: { prioriser: ["Le secret du trombone"], abandonner: [], series: [] },
    verdict_niche: "continuer",
    justification: "Trop tôt pour juger : 4 vidéos.",
    ...overrides,
  };
}

export const TEST_BIBLE = `# BIBLE
chaine:
  nom: "Objets"
  niche: "objets du quotidien"
objectifs:
  kpi_principal: "pourcentage de visionnage complet"
  critere_validation_niche: "10 vidéos à plus de 35 % de visionnage complet"

# ce que l'analyste a appris
apprentissages:
  - "aucun pour l'instant"
`;
