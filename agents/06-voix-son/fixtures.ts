import type { Stage } from "@/lib/generated/prisma/client";
import type { WordTiming } from "@/lib/providers/media";
import type { SttProvider } from "@/lib/providers/stt";
import type { TtsProvider, TtsRequest } from "@/lib/providers/tts";
import type { TrackJson } from "./audioPlan";
import { assertLicensed, type MusicLibrary, type MusicQuery, type MusicStore, type MusicTrack } from "./music";
import type { AudioPorts, AudioVideo } from "./ports";
import { spokenText, spokenWords } from "./rules";
import type { Output } from "./schema";
import type { Script } from "./variables";
import type { StoredVoice, VoiceRecord, VoiceStore } from "./voice";

// Données d'exemple et faux ports pour les tests de l'agent 6 (aucun appel réel à un modèle ni à un fournisseur).

export const TEST_BIBLE = `chaine:
  nom: "Objets"
  niche: "objets du quotidien"
  promesse: "comprendre ce qu'on utilise"
  langue: fr-FR
ligne_editoriale:
  ton: "curieux"
  piliers: ["histoire des objets"]
  sujets_interdits: ["politique"]
format_video:
  duree_cible_s: [20, 30]
  debit_voix_mots_par_s: 2
  loudness_lufs: -14
identite:
  voix: "faux-tts / voix-claire"
  cta: "Abonne-toi pour la suite"
`;

/** Bible du modèle, identité de la voix non remplie. */
export const BIBLE_WITHOUT_VOICE = TEST_BIBLE.replace('"faux-tts / voix-claire"', '"{{MOTEUR_TTS}} / {{ID_VOIX}}"');

const SCRIPT_VOICES = [
  "Ton trombone cache un secret que personne ne t'a dit.",
  "On l'attribue à Johan Vaaler, un Norvégien, en 1899.",
  "Mais son modèle ne ressemblait pas du tout au nôtre.",
  "Le vrai trombone vient d'une usine anglaise, la Gem.",
  "Et la prochaine fois, regarde bien ton trombone.",
];

/** Script de 25 s en 5 beats (0-3, 3-8, 8-15, 15-22, 22-25), 46 mots de voix. */
export function makeScript(): Script {
  const bounds: [Script["beats"][number]["role"], number, number][] = [
    ["accroche", 0, 3],
    ["contexte", 3, 8],
    ["revelation", 8, 15],
    ["chute", 15, 22],
    ["boucle", 22, 25],
  ];
  return {
    idee_id: "I-07",
    titre_interne: "Le vrai inventeur du trombone",
    accroches: [
      { type: "affirmation", voix: "Ton trombone cache un secret.", texte_ecran: "Un secret" },
      { type: "question", voix: "Qui a inventé le trombone ?", texte_ecran: "Qui ?" },
      { type: "situation", voix: "Tu attaches deux feuilles.", texte_ecran: "Deux feuilles" },
    ],
    beats: bounds.map(([role, debut_s, fin_s], index) => ({
      n: index + 1,
      role,
      debut_s,
      fin_s,
      voix: SCRIPT_VOICES[index] ?? "",
      texte_ecran: `Texte du beat ${index + 1}`,
      faits: [],
      intention_visuelle: `Intention ${index + 1}`,
    })),
    nb_mots: 46,
    duree_estimee_s: 23,
    cta: null,
    verifications: { accroche_sans_son: true, faits_tous_sources: true, duree_ok: true },
  };
}

/** 49 mots prononcés : 24,5 s au débit de la bible (2 mots/s). */
export const TTS_TEXT = [
  "Ton trombone cache un secret que personne ne t'a dit.",
  "On l'attribue à Johan Vaaler, un Norvégien, en mille huit cent quatre-vingt-dix-neuf.",
  "Mais son modèle ne ressemblait pas du tout au nôtre.",
  "Le vrai trombone vient d'une usine anglaise, la Gem.",
  "Et la prochaine fois, regarde bien ton trombone.",
].join(" ");

export const CUTS = ["un Norvégien,", "Mais son modèle ne ressemblait pas du tout au nôtre."];

export function makeOutput(overrides: Partial<Output> = {}): Output {
  const direction = (beat: number, ton: string, mots: string[]) => ({ beat, ton, vitesse: 1, mots_appuyes: mots });
  return {
    idee_id: "I-07",
    texte_tts: TTS_TEXT,
    prononciations: [{ mot: "Vaaler", phonetique: "Va-leur" }],
    direction_par_beat: [
      direction(1, "intrigué", ["secret"]),
      direction(2, "complice", ["Vaaler"]),
      direction(3, "grave", ["nôtre"]),
      direction(4, "enthousiaste", ["Gem"]),
      direction(5, "complice", ["trombone"]),
    ],
    musique: {
      ambiance: "curieuse et légère",
      bpm: 96,
      instruments: ["piano", "pizzicato"],
      evolution: "montée sur la chute",
      mots_cles_recherche: ["curious", "pizzicato"],
      licence_requise: "libre de droits, usage commercial sur TikTok, Instagram et YouTube",
    },
    effets: [
      { t_s: 0, effet: "whoosh", plan: "B1" },
      { t_s: 3, effet: "pop", plan: "B2" },
      { t_s: 8, effet: "ding", plan: "B3" },
      { t_s: 15, effet: "impact", plan: "B4" },
    ],
    mixage: { cible_lufs: -14, musique_sous_voix_db: -20, ducking: true },
    coupes_si_trop_long: CUTS,
    ...overrides,
  };
}

/** Plans du storyboard (même découpage que les tests de l'agent 5) : P01 0-3, P03 5,5-8, P04 8-11, P06 15-18,5. */
export const STORYBOARD_EFFECTS: Output["effets"] = [
  { t_s: 0, effet: "whoosh", plan: "P01" },
  { t_s: 5.5, effet: "pop", plan: "P03" },
  { t_s: 8, effet: "ding", plan: "P04" },
  { t_s: 15, effet: "impact", plan: "P06" },
];

export const LICENSED_TRACK: MusicTrack = {
  id: "t-1",
  title: "Pizzicato curieux",
  url: "https://musique.test/pizzicato.mp3",
  license: "Licence libre de droits, usage commercial toutes plateformes",
  commercialUse: true,
  durationS: 120,
  bpm: 100,
  cost: 0,
};

export const MANUAL_TRACK: TrackJson = { titre: "Ma piste", url: "https://musique.test/ma-piste.mp3", fournisseur: "choix manuel", licence: "CC0", source: "manuel" };

// ---------------------------------------------------------------------------
// Faux fournisseurs.
// ---------------------------------------------------------------------------

/** Horodatage régulier : un mot toutes les `durationS / mots` secondes. */
export function timingsFor(text: string, durationS: number): WordTiming[] {
  const words = spokenText(text).split(" ").filter((word) => word !== "");
  const step = durationS / Math.max(words.length, 1);
  return words.map((word, index) => ({ word, startS: index * step, endS: (index + 1) * step }));
}

export type FakeTts = TtsProvider & { requests: TtsRequest[] };

/** Moteur factice : 0,001 € par mot ; durée par défaut = mots ÷ 2 (le débit de la bible d'exemple). */
export function makeTts(options: { durationOf?: (text: string) => number; withWords?: boolean } = {}): FakeTts {
  const requests: TtsRequest[] = [];
  const durationOf = options.durationOf ?? ((text: string) => spokenWords(text) / 2);
  return {
    name: "faux-tts",
    supportedTags: ['<break time="0.5s"/>'],
    requests,
    estimateCost: (text) => spokenWords(text) / 1000,
    async synthesize(request) {
      requests.push(request);
      const durationS = durationOf(request.text);
      return {
        url: `https://voix.test/voix-${requests.length}.mp3`,
        durationS,
        words: options.withWords === false ? null : timingsFor(request.text, durationS),
        cost: spokenWords(request.text) / 1000,
      };
    },
  };
}

export type FakeStt = SttProvider & { requests: string[] };

export function makeStt(): FakeStt {
  const requests: string[] = [];
  return {
    name: "faux-whisper",
    requests,
    async transcribe(request) {
      requests.push(request.audioUrl);
      return { text: "transcription", words: [{ word: "Ton", startS: 0, endS: 0.4 }], cost: 0.002 };
    },
  };
}

export type FakeLibrary = MusicLibrary & { queries: MusicQuery[] };

export function makeLibrary(tracks: MusicTrack[] = [LICENSED_TRACK]): FakeLibrary {
  const queries: MusicQuery[] = [];
  return {
    name: "fausse-banque",
    queries,
    async search(query) {
      queries.push(query);
      return tracks;
    },
  };
}

// ---------------------------------------------------------------------------
// Faux magasins et faux ports.
// ---------------------------------------------------------------------------

export type FakeVoiceStore = VoiceStore & { records: VoiceRecord[]; timings: { key: string; cost: number }[] };

/** Voix en mémoire : une clé enregistrée n'est jamais régénérée ; le coût s'ajoute à la vidéo. */
export function makeVoiceStore(video?: AudioVideo): FakeVoiceStore {
  const records: VoiceRecord[] = [];
  const timings: { key: string; cost: number }[] = [];
  return {
    records,
    timings,
    async findVoice(key): Promise<StoredVoice | null> {
      const record = records.find((entry) => entry.key === key);
      return record ? { key: record.key, url: record.url, provider: record.provider, durationS: record.durationS, words: record.words, timingSource: record.timingSource } : null;
    },
    async countVoices(videoId) {
      return records.filter((entry) => entry.videoId === videoId).length;
    },
    async recordVoice(record) {
      if (records.some((entry) => entry.key === record.key)) throw new Error(`clé déjà enregistrée : ${record.key}`);
      records.push(record);
      if (video) video.totalCost += record.cost;
    },
    async recordTimings(key, words, cost) {
      const record = records.find((entry) => entry.key === key);
      if (!record) throw new Error(`voix inconnue : ${key}`);
      record.words = words;
      record.timingSource = "stt";
      timings.push({ key, cost });
      if (video) video.totalCost += cost;
    },
  };
}

export type FakeMusicStore = MusicStore & { tracks: TrackJson[]; manual: TrackJson | null };

export function makeMusicStore(manual: TrackJson | null = null, video?: AudioVideo): FakeMusicStore {
  const store: FakeMusicStore = {
    tracks: [],
    manual,
    async findManualChoice() {
      return store.manual;
    },
    async recordTrack(_videoId, track, cost) {
      assertLicensed(track);
      if (store.tracks.some((entry) => entry.url === track.url)) return;
      store.tracks.push(track);
      if (track.source === "manuel") store.manual = track;
      if (video) video.totalCost += cost;
    },
  };
  return store;
}

export type PortOptions = {
  stage?: Stage;
  exists?: boolean;
  video?: Partial<AudioVideo>;
  tts?: FakeTts | null;
  stt?: FakeStt | null;
  library?: FakeLibrary | null;
  manual?: TrackJson | null;
  perVideo?: string | undefined;
  latestOutput?: Output | null;
};

export type FakeAudioPorts = {
  ports: AudioPorts;
  video: AudioVideo;
  voices: FakeVoiceStore;
  music: FakeMusicStore;
  calls: { saved: unknown[]; completed: number; blocked: string[] };
};

/** Vidéo en mémoire : les transitions changent l'étape comme lib/pipeline (MEDIA_DONE attend aussi le storyboard). */
export function makePorts(options: PortOptions = {}): FakeAudioPorts {
  const video: AudioVideo = { stage: options.stage ?? "VISUALS_AND_AUDIO", blockedAt: null, script: makeScript(), storyboard: null, audio: null, totalCost: 0.2, ...options.video };
  const voices = makeVoiceStore(video);
  const music = makeMusicStore(options.manual ?? null, video);
  const calls = { saved: [] as unknown[], completed: 0, blocked: [] as string[] };
  const ports: AudioPorts = {
    async loadVideo() {
      return options.exists === false ? null : { ...video };
    },
    async loadLatestOutput() {
      return options.latestOutput ?? null;
    },
    async saveAudioPlan(_videoId, plan) {
      calls.saved.push(plan);
      video.audio = plan;
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
    budgets: () => ({ perVideo: "perVideo" in options ? options.perVideo : "5" }),
    tools: {
      tts: options.tts === undefined ? makeTts() : options.tts,
      stt: options.stt ?? null,
      music: options.library === undefined ? makeLibrary() : options.library,
    },
    voices,
    music,
  };
  return { ports, video, voices, music, calls };
}
