import { IDEA, makeDossier, makeScript, TEST_BIBLE } from "@/agents/04-scenariste/fixtures";
import { CHECK_IDS, type Check, type CheckId } from "./checklist";
import type { QaVideo, RenderEvidence } from "./ports";
import type { QaContext } from "./rules";
import type { Output } from "./schema";
import type { AudioPlan, Storyboard, Timeline } from "./variables";

// Données d'exemple pour les tests de l'agent 8 (aucun appel réel au modèle).
// Bible, idée, dossier et script viennent des données d'exemple du scénariste (cible 20 à 30 s).

export { IDEA, makeDossier, makeScript, TEST_BIBLE };

/** Deux plans : une image IA stylisée (non réaliste) et un texte animé. */
export function makeStoryboard(overrides: Partial<Storyboard["plans"][number]> = {}): Storyboard {
  const plan = (id: string, type: Storyboard["plans"][number]["type"]) => ({
    id,
    beat: 1,
    debut_s: 0,
    fin_s: 3,
    type,
    description_fr: "Trombone en gros plan, style illustration",
    prompt_en: type === "texte_anime" ? null : "flat illustration of a paperclip, vertical 9:16 composition",
    negative_prompt_en: null,
    mouvement: "zoom lent",
    mots_cles_stock: [],
    texte_ecran: "Un secret industriel",
    position_texte: "centre" as const,
    transition_sortie: "cut" as const,
    label_ia_requis: false,
  });
  return {
    idee_id: "I-07",
    plans: [{ ...plan("P1", "image_ia_animee"), ...overrides }, plan("P2", "texte_anime")],
    secondes_video_ia: 0,
    personnages_recurrents: [],
    couverture: { plan: "P1", texte: "Le secret du trombone" },
  };
}

export function makeAudioPlan(): AudioPlan {
  return {
    idee_id: "I-07",
    texte_tts: "Ton trombone cache un secret industriel.",
    prononciations: [],
    direction_par_beat: [{ beat: 1, ton: "complice", vitesse: 1, mots_appuyes: ["secret"] }],
    musique: { ambiance: "curieuse", bpm: 100, instruments: ["piano"], evolution: "monte", mots_cles_recherche: ["curious"], licence_requise: "commerciale" },
    effets: [],
    mixage: { cible_lufs: -14, musique_sous_voix_db: -18, ducking: true },
    coupes_si_trop_long: [],
  };
}

export function makeTimeline(durationS = 25): Timeline {
  return {
    idee_id: "I-07",
    duree_totale_s: durationS,
    export: { largeur: 1080, hauteur: 1920, fps: 30, codec: "h264", audio: "aac_48k" },
    pistes: { video: [], texte: [], sous_titres: [], audio: [] },
    alertes: [],
  };
}

/** Vidéo en contrôle avec toutes les sorties des agents précédents. */
export function makeVideo(overrides: Partial<QaVideo> = {}): QaVideo {
  return {
    stage: "QA",
    idea: IDEA,
    dossier: makeDossier(),
    script: makeScript(),
    storyboard: makeStoryboard(),
    audio: makeAudioPlan(),
    timeline: makeTimeline(),
    partnership: "aucun",
    previousReport: null,
    ...overrides,
  };
}

export const FULL_EVIDENCE: RenderEvidence = {
  transcription: "Ton trombone cache un secret industriel. Tu en utilises des dizaines…",
  captures: ["Gros plan d'un trombone illustré", "Texte « Un secret industriel »", "Page de brevet", "Deux schémas", "Retour au trombone"],
};

export const NO_EVIDENCE: RenderEvidence = { transcription: null, captures: null };

/** Contexte des règles quand tout est disponible : voix de synthèse, image IA non réaliste, pas de partenariat. */
export function makeContext(overrides: Partial<QaContext> = {}): QaContext {
  return {
    ideaId: "I-07",
    hasPartnership: false,
    available: { STORYBOARD: true, PLAN_SONORE: true, TIMELINE: true, TRANSCRIPTION: true, CAPTURES: true },
    media: { realisticAi: false, aiVisuals: true, aiVoice: true },
    durationTarget: { minS: 20, maxS: 30 },
    timelineDurationS: 25,
    ...overrides,
  };
}

const okCheck = (id: CheckId): Check => ({ id, statut: "ok", preuve: `Vérifié : ${id}.`, correction: null, agent_responsable: null });
const NA_WITHOUT_PARTNERSHIP: readonly CheckId[] = ["D2", "D3", "D4"];

/** Les 16 points : ok, sauf D2 à D4 sans objet (pas d'hypertrucage, pas de partenariat). */
export function makeChecks(): Check[] {
  return CHECK_IDS.map((id) => (NA_WITHOUT_PARTNERSHIP.includes(id) ? { ...okCheck(id), statut: "na", preuve: "Sans objet ici." } : okCheck(id)));
}

export function makeReport(overrides: Partial<Output> = {}): Output {
  return {
    idee_id: "I-07",
    decision: "GO",
    controles: makeChecks(),
    etiquettes: { tiktok_contenu_ia: true, instagram_contenu_ia: true, youtube_utilisation_ia: false, contenu_de_marque: false },
    mentions_a_incruster: [],
    resume_pour_humain: "Vidéo conforme.\nÉtiquettes IA TikTok et Instagram (voix de synthèse).",
    ...overrides,
  };
}

/** Remplace un point (repéré par son id) du rapport d'exemple. */
export function withCheck(id: CheckId, changes: Partial<Check>, report: Output = makeReport()): Output {
  return { ...report, controles: report.controles.map((check) => (check.id === id ? { ...check, ...changes } : check)) };
}

export const koCheck = (correction: string, agent: string): Partial<Check> => ({ statut: "ko", preuve: "Problème constaté.", correction, agent_responsable: agent });
