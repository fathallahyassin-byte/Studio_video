import type { Stage } from "@/lib/generated/prisma/client";
import type { ImageGenProvider, ImageGenRequest } from "@/lib/providers/imageGen";
import type { VideoGenProvider, VideoGenRequest } from "@/lib/providers/videoGen";
import type { GenerationRecord, MediaPorts, VisualTools } from "./generation";
import type { StoryboardPorts, StoryboardVideo } from "./ports";
import type { Plan } from "./rules";
import type { Output } from "./schema";
import type { Script } from "./variables";

// Données d'exemple et faux ports pour les tests de l'agent 5 (aucun appel réel à un modèle ou à un générateur).

export const STYLE_SUFFIX = "flat pastel illustration, soft light";

export const TEST_BIBLE = `chaine:
  nom: "Objets"
  niche: "objets du quotidien"
  promesse: "comprendre ce qu'on utilise"
ligne_editoriale:
  ton: "curieux"
  piliers: ["histoire des objets"]
  sujets_interdits: ["politique"]
format_video:
  duree_cible_s: [20, 30]
  debit_voix_mots_par_s: 2
identite:
  voix: "moteur / voix"
  style_visuel_en: "${STYLE_SUFFIX}"
  cta: "Abonne-toi pour la suite"
`;

/** Script de 25 s en 5 beats (0-3, 3-8, 8-15, 15-22, 22-25). */
export function makeScript(): Script {
  const beat = (n: number, role: Script["beats"][number]["role"], debut_s: number, fin_s: number) => ({
    n,
    role,
    debut_s,
    fin_s,
    voix: `Voix du beat ${n}.`,
    texte_ecran: `Texte ${n}`,
    faits: [],
    intention_visuelle: `Intention ${n}`,
  });
  return {
    idee_id: "I-07",
    titre_interne: "Le vrai inventeur du trombone",
    accroches: [
      { type: "affirmation", voix: "Ton trombone cache un secret.", texte_ecran: "Un secret" },
      { type: "question", voix: "Qui a inventé le trombone ?", texte_ecran: "Qui ?" },
      { type: "situation", voix: "Tu attaches deux feuilles.", texte_ecran: "Deux feuilles" },
    ],
    beats: [beat(1, "accroche", 0, 3), beat(2, "contexte", 3, 8), beat(3, "revelation", 8, 15), beat(4, "chute", 15, 22), beat(5, "boucle", 22, 25)],
    nb_mots: 50,
    duree_estimee_s: 25,
    cta: null,
    verifications: { accroche_sans_son: true, faits_tous_sources: true, duree_ok: true },
  };
}

const prompt = (subject: string) => `${subject}, close-up, 35mm lens, warm light, curious mood, vertical 9:16 composition, ${STYLE_SUFFIX}`;

export function makePlan(id: string, beat: number, debut_s: number, fin_s: number, type: Plan["type"], changes: Partial<Plan> = {}): Plan {
  const generated = type === "image_ia_animee" || type === "video_ia";
  return {
    id,
    beat,
    debut_s,
    fin_s,
    type,
    description_fr: `Plan ${id}`,
    prompt_en: generated ? prompt(`paperclip scene ${id}`) : null,
    negative_prompt_en: generated ? "text, logo, watermark, real person" : null,
    mouvement: "zoom lent",
    mots_cles_stock: type === "stock" ? ["office desk", "paper"] : [],
    texte_ecran: type === "texte_anime" ? "1899" : "",
    position_texte: "centre",
    transition_sortie: "cut",
    label_ia_requis: type === "video_ia",
    ...changes,
  };
}

/** 8 plans de 0 à 25 s, dont 2 plans video_ia de 3 s (6 s de vidéo IA). */
export function makePlans(): Plan[] {
  return [
    makePlan("P01", 1, 0, 3, "video_ia"),
    makePlan("P02", 2, 3, 5.5, "image_ia_animee"),
    makePlan("P03", 2, 5.5, 8, "stock"),
    makePlan("P04", 3, 8, 11, "texte_anime"),
    makePlan("P05", 3, 11, 15, "image_ia_animee"),
    makePlan("P06", 4, 15, 18.5, "image_ia_animee"),
    makePlan("P07", 4, 18.5, 22, "stock"),
    makePlan("P08", 5, 22, 25, "video_ia"),
  ];
}

export function makeStoryboard(overrides: Partial<Output> = {}): Output {
  return {
    idee_id: "I-07",
    plans: makePlans(),
    secondes_video_ia: 6,
    personnages_recurrents: [{ nom: "L'inventeur", description_en: "a thin man in his 40s with round glasses and a grey 1890s suit" }],
    couverture: { plan: "P01", texte: "Le vrai inventeur" },
    ...overrides,
  };
}

/** Remplace un plan (repéré par son id) du storyboard d'exemple. */
export function withPlan(id: string, changes: Partial<Plan>, storyboard: Output = makeStoryboard()): Output {
  return { ...storyboard, plans: storyboard.plans.map((plan) => (plan.id === id ? { ...plan, ...changes } : plan)) };
}

// ---------------------------------------------------------------------------
// Faux générateurs et faux ports.
// ---------------------------------------------------------------------------

export type FakeImage = ImageGenProvider & { requests: ImageGenRequest[] };
export type FakeVideo = VideoGenProvider & { requests: VideoGenRequest[] };

export function makeImageProvider(unitCost = 0.04): FakeImage {
  const requests: ImageGenRequest[] = [];
  return {
    name: "faux-image",
    requests,
    estimateCost: () => unitCost,
    async generate(request) {
      requests.push(request);
      return { url: `https://media.test/image-${requests.length}.png`, cost: unitCost, license: null };
    },
  };
}

export function makeVideoProvider(costPerSecond = 0.1): FakeVideo {
  const requests: VideoGenRequest[] = [];
  return {
    name: "faux-video",
    requests,
    estimateCost: (request) => request.durationS * costPerSecond,
    async generate(request) {
      requests.push(request);
      return { url: `https://media.test/video-${requests.length}.mp4`, cost: request.durationS * costPerSecond, license: null };
    },
  };
}

export type FakeMedia = MediaPorts & { records: GenerationRecord[] };

/** Médias en mémoire : une clé enregistrée n'est jamais régénérée ; le coût s'ajoute à la vidéo. */
export function makeMediaPorts(tools: VisualTools, video?: StoryboardVideo): FakeMedia {
  const records: GenerationRecord[] = [];
  return {
    tools,
    records,
    async findGeneration(key) {
      const record = records.find((entry) => entry.key === key);
      return record ? { url: record.media.url } : null;
    },
    async countGenerations(videoId, planId) {
      return records.filter((entry) => entry.videoId === videoId && entry.planId === planId).length;
    },
    async recordGeneration(record) {
      if (records.some((entry) => entry.key === record.key)) throw new Error(`clé déjà enregistrée : ${record.key}`);
      records.push(record);
      if (video) video.totalCost += record.media.cost;
    },
  };
}

export type PortOptions = {
  stage?: Stage;
  exists?: boolean;
  video?: Partial<StoryboardVideo>;
  tools?: VisualTools | "none";
  budgets?: { videoAiSeconds?: string | undefined; perVideo?: string | undefined };
};

export type FakeStoryboardPorts = {
  ports: StoryboardPorts;
  video: StoryboardVideo;
  media: FakeMedia;
  image: FakeImage;
  videoGen: FakeVideo;
  calls: { saved: Output[]; completed: number; blocked: string[] };
};

/** Vidéo en mémoire : les transitions changent l'étape comme le ferait lib/pipeline (MEDIA_DONE attend l'agent 6). */
export function makePorts(options: PortOptions = {}): FakeStoryboardPorts {
  const video: StoryboardVideo = { stage: options.stage ?? "VISUALS_AND_AUDIO", blockedAt: null, script: makeScript(), storyboard: null, totalCost: 0.2, ...options.video };
  const image = makeImageProvider();
  const videoGen = makeVideoProvider();
  const tools: VisualTools = options.tools === "none" ? { image: null, video: null } : (options.tools ?? { image, video: videoGen });
  const media = makeMediaPorts(tools, video);
  const calls = { saved: [] as Output[], completed: 0, blocked: [] as string[] };
  const budgets = { videoAiSeconds: "12", perVideo: "5", ...options.budgets };
  const ports: StoryboardPorts = {
    async loadVideo() {
      return options.exists === false ? null : { ...video };
    },
    async saveStoryboard(_videoId, storyboard) {
      calls.saved.push(storyboard);
      video.storyboard = storyboard;
    },
    async completeMedia() {
      if (video.stage !== "VISUALS_AND_AUDIO") throw new Error("transition impossible");
      calls.completed += 1;
      video.stage = "EDIT";
    },
    async blockVideo(_videoId, reason) {
      calls.blocked.push(reason);
      video.blockedAt = video.stage;
      video.stage = "NEEDS_FIX";
    },
    budgets: () => budgets,
    media,
  };
  return { ports, video, media, image, videoGen, calls };
}
