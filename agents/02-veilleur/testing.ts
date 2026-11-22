// Données et faux partagés par les tests du veilleur (aucune base, aucun appel réel au modèle).
import type { ExistingProposal, Proposal, RecentVideo, ScoutStore } from "./proposals";
import type { Idea, Notes } from "./rules";
import type { Output } from "./schema";
import type { Learning } from "./variables";

export const PILLARS = ["Objets de la cuisine", "Objets du bureau", "Objets de la salle de bain"];

const SUBJECTS = [
  "Pourquoi les capsules de bière ont 21 dents",
  "Qui a inventé la pince à linge",
  "L'histoire du premier post-it",
  "Le vrai rôle du petit trou du stylo",
  "Pourquoi les crayons à papier sont jaunes",
  "L'origine du code-barres",
  "Le Velcro copié sur une plante",
  "Pourquoi le clavier n'est pas alphabétique",
  "Le secret du trombone",
  "Pourquoi le savon mousse",
  "La boîte de conserve avant l'ouvre-boîte",
  "Pourquoi les fourchettes ont quatre dents",
  "Le mystère des boutons de chemise",
  "Pourquoi les agrafeuses claquent",
  "L'invention de la brosse à dents en nylon",
  "Pourquoi le dentifrice a des rayures",
  "Le premier rouleau de papier toilette",
  "Pourquoi les éponges sont vertes et jaunes",
  "Le couteau suisse et l'armée",
  "Pourquoi les gommes effacent le graphite",
];

export const BASE_NOTES: Notes = { accroche: 4, interet: 4, originalite: 3, faisabilite_visuelle: 5, verifiabilite: 4 };

export function makeIdea(index: number, overrides: Partial<Idea> = {}): Idea {
  const angle = SUBJECTS[index] ?? `Sujet numéro ${index}`;
  return {
    id: `IDEE-${String(index + 1).padStart(3, "0")}`,
    pilier: PILLARS[index % PILLARS.length] ?? "Objets de la cuisine",
    format: "révélation",
    angle,
    accroche: `Accroche : ${angle}`,
    revelation: `Révélation sur ${angle}`,
    pourquoi_maintenant: "evergreen",
    notes: BASE_NOTES,
    score: 4,
    hypothese: false,
    ...overrides,
  };
}

export function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    semaine: "2026-W01",
    idees: Array.from({ length: 20 }, (_, index) => makeIdea(index)),
    series: [
      { titre: "Les dents des objets", episodes: ["Capsules", "Fourchettes", "Peignes"] },
      { titre: "Inventions par accident", episodes: ["Post-it", "Velcro", "Nylon"] },
      { titre: "Couleurs du quotidien", episodes: ["Crayons", "Éponges", "Dentifrice"] },
    ],
    ecartees: [{ idee: "Le scandale d'un PDG", raison: "personne réelle" }],
    ...overrides,
  };
}

export const LEARNING: Learning = { observation: "Les objets de cuisine retiennent mieux", nb_videos: 6, confiance: "forte", decision: "prioriser la cuisine" };

type FakeVideo = { id: string; title: string; stage: "IDEA" | "AWAITING_V1"; ideaId: string | null; scoutJobId: string | null; procheDe: string | null };

export type FakeScoutStore = ScoutStore & {
  videos: FakeVideo[];
  notifications: number;
  /** simule un crash : erreur levée juste après la création de la vidéo n° N, avant sa transition */
  crashAfterCreates: number | null;
};

export function createFakeScoutStore(initial: { signals?: string; learnings?: Learning[]; titles?: string[] } = {}): FakeScoutStore {
  let created = 0;
  const store: FakeScoutStore = {
    videos: (initial.titles ?? []).map((title, index) => ({ id: `old-${index}`, title, stage: "AWAITING_V1", ideaId: null, scoutJobId: null, procheDe: null })),
    notifications: 0,
    crashAfterCreates: null,
    async loadSignals() {
      return initial.signals ?? "";
    },
    async loadLearnings() {
      return initial.learnings ?? [];
    },
    async listRecentVideos(): Promise<RecentVideo[]> {
      return store.videos.map((video) => ({ title: video.title, scoutJobId: video.scoutJobId }));
    },
    async listProposalsOfJob(_channelId, jobId): Promise<ExistingProposal[]> {
      return store.videos
        .filter((video) => video.scoutJobId === jobId)
        .map((video) => ({ videoId: video.id, ideaId: video.ideaId, stuckInIdea: video.stage === "IDEA" }));
    },
    async proposeIdeas(_channelId, proposals: readonly Proposal[]) {
      const ids: string[] = [];
      for (const proposal of proposals) {
        created += 1;
        const video: FakeVideo = { id: `v-${created}`, title: proposal.title, stage: "IDEA", ideaId: proposal.idea.id, scoutJobId: proposal.idea.veille.jobId, procheDe: proposal.idea.proche_de };
        store.videos.push(video);
        if (store.crashAfterCreates === created) throw new Error("crash simulé");
        video.stage = "AWAITING_V1";
        ids.push(video.id);
      }
      if (ids.length > 0) store.notifications += 1;
      return ids;
    },
    async confirmProposal(videoId) {
      const video = store.videos.find((entry) => entry.id === videoId);
      if (video) video.stage = "AWAITING_V1";
    },
    async notifyIdeasWaiting() {
      store.notifications += 1;
    },
  };
  return store;
}
