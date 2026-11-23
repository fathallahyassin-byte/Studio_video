import type { AudioPlan as StoredAudioPlan } from "@/agents/06-voix-son/audioPlan";
import type { Stage } from "@/lib/generated/prisma/client";
import type { WordTiming } from "@/lib/providers/media";
import type { EditAsset, EditPorts, EditVideo } from "./ports";
import type { Output } from "./schema";
import { inspectSources, requireEditContext, type AudioPlan, type EditContext, type Storyboard, type StoryboardPlan } from "./sources";

// Données d'exemple et faux ports pour les tests de l'agent 7 (aucun appel réel à un modèle, à la base ou au rendu).

export const VOICE_URL = "https://media.test/voix.mp3";
export const MUSIC_URL = "https://media.test/musique.mp3";
export const MEDIA_URLS = { P02: "https://media.test/stock-p02.mp4", P03: "https://media.test/image-p03.png", P04: "https://media.test/video-p04.mp4" } as const;

export const TEST_BIBLE = `chaine:
  nom: "Objets"
  niche: "objets du quotidien"
  promesse: "comprendre ce qu'on utilise"
format_video:
  duree_cible_s: [10, 15]
  debit_voix_mots_par_s: 2
`;

/** 24 mots, un toutes les 0,5 s (0,45 s chacun) : dernier mot de 11,5 à 11,95 s. */
export const SENTENCE =
  "Ton trombone cache un secret. Personne ne sait vraiment qui l'a inventé, pas même les historiens. Pourtant la réponse tient en une seule date.";

export function makeWords(text = SENTENCE, stepS = 0.5, lengthS = 0.45): WordTiming[] {
  return text.split(" ").map((word, index) => ({ word, startS: index * stepS, endS: index * stepS + lengthS }));
}

function plan(id: string, beat: number, debut_s: number, fin_s: number, type: StoryboardPlan["type"]): StoryboardPlan {
  return {
    id,
    beat,
    debut_s,
    fin_s,
    type,
    description_fr: `Plan ${id}`,
    prompt_en: type === "image_ia_animee" || type === "video_ia" ? `paperclip ${id}, vertical 9:16 composition` : null,
    negative_prompt_en: type === "image_ia_animee" || type === "video_ia" ? "text, logo" : null,
    mouvement: "zoom lent",
    mots_cles_stock: type === "stock" ? ["office desk"] : [],
    texte_ecran: type === "texte_anime" ? "1899" : "",
    position_texte: "centre",
    transition_sortie: "cut",
    label_ia_requis: type === "video_ia",
  };
}

/** 4 plans de 3 s : un texte animé (sans fichier) et trois plans qui demandent un fichier. */
export function makeStoryboard(): Storyboard {
  return {
    idee_id: "I-07",
    plans: [plan("P01", 1, 0, 3, "texte_anime"), plan("P02", 2, 3, 6, "stock"), plan("P03", 3, 6, 9, "image_ia_animee"), plan("P04", 4, 9, 12, "video_ia")],
    secondes_video_ia: 3,
    personnages_recurrents: [],
    couverture: { plan: "P01", texte: "Un secret" },
  };
}

export function makeAudioPlan(overrides: Partial<AudioPlan> = {}): AudioPlan {
  return {
    idee_id: "I-07",
    texte_tts: SENTENCE,
    prononciations: [],
    direction_par_beat: [{ beat: 1, ton: "intrigué", vitesse: 1, mots_appuyes: ["secret"] }],
    musique: { ambiance: "curieuse", bpm: 100, instruments: ["piano"], evolution: "montée sur la chute", mots_cles_recherche: ["curious piano"], licence_requise: "commerciale" },
    effets: [{ t_s: 3, effet: "whoosh", plan: "P02" }],
    mixage: { cible_lufs: -14, musique_sous_voix_db: -20, ducking: true },
    coupes_si_trop_long: [],
    ...overrides,
  };
}

/** Plan sonore enregistré par l'agent 6 : sortie du modèle + bloc « production » (voix, horodatage, musique). */
export function makeAudioJson(options: { words?: WordTiming[]; durationS?: number; musicLicense?: string } = {}): StoredAudioPlan {
  return {
    ...makeAudioPlan(),
    production: {
      duree_estimee_s: 12,
      duree_cible_s: [10, 15],
      voix: {
        url: VOICE_URL,
        fournisseur: "faux-tts",
        voix_id: "voix-1",
        langue: "fr-FR",
        duree_s: options.durationS ?? 12.1,
        mots: options.words ?? makeWords(),
        horodatage: "tts",
        coupes_appliquees: [],
        tentative: 1,
      },
      musique: { titre: "Curious", url: MUSIC_URL, fournisseur: "banque", licence: options.musicLicense ?? "Banque X, usage commercial 3 plateformes", source: "banque" },
    },
  };
}

export function makeAssets(): EditAsset[] {
  return [
    { type: "VIDEO", url: MEDIA_URLS.P04, planId: "P04", durationS: 3, license: null },
    { type: "IMAGE", url: MEDIA_URLS.P03, planId: "P03", durationS: null, license: null },
    { type: "VIDEO", url: MEDIA_URLS.P02, planId: "P02", durationS: 3, license: "Pexels" },
  ];
}

/** Sortie du modèle conforme : rythme et transitions choisis, le reste sera imposé en code. */
export function makeTimeline(overrides: Partial<Output> = {}): Output {
  const clip = (id: keyof typeof MEDIA_URLS | "P01", debut_s: number, fin_s: number, transition: string) => ({
    plan: id,
    src: id === "P01" ? "" : MEDIA_URLS[id],
    debut_s,
    fin_s,
    mouvement: "zoom_in_lent",
    transition_entree: transition,
    manquant: false,
  });
  return {
    idee_id: "I-07",
    duree_totale_s: 12.2,
    export: { largeur: 1080, hauteur: 1920, fps: 30, codec: "h264", audio: "aac_48k" },
    pistes: {
      video: [clip("P01", 0, 2.5, "cut"), clip("P02", 2.5, 6, "whip"), clip("P03", 6, 9, "cut"), clip("P04", 9, 12.2, "zoom")],
      texte: [
        { texte: "1899", debut_s: 0.2, fin_s: 2.4, position: "centre", animation: "pop" },
        { texte: "Qui ?", debut_s: 4, fin_s: 5.5, position: "haut", animation: "slide" },
      ],
      sous_titres: [],
      audio: [{ type: "voix", src: VOICE_URL, debut_s: 0, volume_db: 0, ducking: false }],
    },
    alertes: [],
    ...overrides,
  };
}

/** Le plan `id` de la piste vidéo (erreur s'il n'y est pas). */
export function clipOf(id: string, timeline: Output = makeTimeline()): Output["pistes"]["video"][number] {
  const clip = timeline.pistes.video.find((entry) => entry.plan === id);
  if (!clip) throw new Error(`plan ${id} absent de la timeline d'exemple`);
  return clip;
}

export function withClips(changes: (clips: Output["pistes"]["video"]) => Output["pistes"]["video"], timeline: Output = makeTimeline()): Output {
  return { ...timeline, pistes: { ...timeline.pistes, video: changes(timeline.pistes.video) } };
}

export function makeVideo(overrides: Partial<EditVideo> = {}): EditVideo {
  return { stage: "EDIT", blockedAt: null, storyboard: makeStoryboard(), audio: makeAudioJson(), timeline: null, ...overrides };
}

export function makeContext(video: EditVideo = makeVideo(), assets: EditAsset[] = makeAssets()): EditContext {
  return requireEditContext(inspectSources(video, assets));
}

export type FakeEditPorts = {
  ports: EditPorts;
  video: EditVideo;
  assets: EditAsset[];
  calls: { saved: Output[]; completed: number; blocked: string[]; renders: number };
};

export type PortOptions = { video?: Partial<EditVideo>; assets?: EditAsset[]; failComplete?: Error };

/** Faux ports : la vidéo vit en mémoire ; EDIT_DONE la passe au rendu, un blocage la met à corriger. */
export function makePorts(options: PortOptions = {}): FakeEditPorts {
  const video = makeVideo(options.video);
  const assets = options.assets ?? makeAssets();
  const calls: FakeEditPorts["calls"] = { saved: [], completed: 0, blocked: [], renders: 0 };
  const moveTo = (stage: Stage, blockedAt: Stage | null) => {
    video.stage = stage;
    video.blockedAt = blockedAt;
  };
  const ports: EditPorts = {
    loadVideo: async () => ({ ...video }),
    loadAssets: async () => [...assets],
    async saveTimeline(_videoId, timeline) {
      calls.saved.push(timeline);
      video.timeline = timeline;
    },
    async completeEdit() {
      if (options.failComplete) throw options.failComplete;
      calls.completed += 1;
      moveTo("RENDER", null);
    },
    async blockVideo(_videoId, reason) {
      calls.blocked.push(reason);
      moveTo("NEEDS_FIX", "EDIT");
    },
    async queueRender() {
      calls.renders += 1;
      return { queued: true };
    },
  };
  return { ports, video, assets, calls };
}
