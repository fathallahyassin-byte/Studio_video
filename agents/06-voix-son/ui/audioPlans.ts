import type { ChipTone } from "@/components/ui";
import type { Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { parseStoredAudioPlan, parseStoredOutput, type TrackJson } from "../audioPlan";
import { canEditAt } from "../regenerate";
import { durationVerdict, roundTenth } from "../rules";
import type { Output } from "../schema";

// Modèle de vue du panneau : données sérialisables, calculées côté serveur (fonctions pures).

export type AudioRow = {
  id: string;
  label: string;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  blockedReason: string | null;
  updatedLabel: string;
  audioJson: unknown;
  /** sortie du dernier AgentRun réussi de l'agent 6 (plan non enregistré quand la vidéo est bloquée) */
  latestOutput: unknown;
  /** dernière piste choisie à la main (Asset MUSIC) ; null s'il n'y en a pas */
  manualTrack: TrackJson | null;
};

/** `notice` non nul : la vidéo attend une action de l'humain (seul cas affiché en jaune). */
export type AudioStatus = { label: string; tone: ChipTone; notice: string | null };

export type VoiceView = { url: string; seconds: string; durationLabel: string; inTarget: boolean; timingLabel: string; attemptLabel: string; appliedCuts: string[] };

export type AudioView = {
  videoId: string;
  label: string;
  title: string;
  updatedLabel: string;
  status: AudioStatus;
  /** plan sonore enregistré (voix et musique réglées) ; sinon c'est la dernière sortie du modèle */
  saved: boolean;
  text: string;
  targetLabel: string | null;
  pronunciations: { word: string; phonetic: string }[];
  directions: { beat: number; tone: string; speed: string; emphasis: string }[];
  voice: VoiceView | null;
  brief: { mood: string; bpm: string; instruments: string; evolution: string; keywords: string; license: string };
  track: { title: string; url: string; license: string; source: string } | null;
  effects: { time: string; effect: string; plan: string }[];
  mix: string;
  proposedCuts: string[];
  /** le son se modifie encore à cette étape (avant le rendu) */
  editable: boolean;
};

export function formatSeconds(value: number): string {
  return `${String(roundTenth(value)).replace(".", ",")} s`;
}

const decimal = (value: number) => String(value).replace(".", ",");

export function toAudioView(row: AudioRow): AudioView | null {
  const plan = parseStoredAudioPlan(row.audioJson);
  const output: Output | null = plan ?? parseStoredOutput(row.latestOutput);
  if (!output) return null;
  const track = plan ? plan.production.musique : row.manualTrack;
  const editable = canEditAt(row);
  return {
    videoId: row.id,
    label: row.label,
    title: row.title,
    updatedLabel: row.updatedLabel,
    status: toStatus(row, plan !== null),
    saved: plan !== null,
    text: output.texte_tts,
    targetLabel: plan ? `${decimal(plan.production.duree_cible_s[0])} à ${decimal(plan.production.duree_cible_s[1])} s` : null,
    pronunciations: output.prononciations.map((entry) => ({ word: entry.mot, phonetic: entry.phonetique })),
    directions: output.direction_par_beat.map((direction) => ({
      beat: direction.beat,
      tone: direction.ton,
      speed: `×${decimal(direction.vitesse)}`,
      emphasis: direction.mots_appuyes.join(", "),
    })),
    voice: plan ? toVoiceView(plan.production) : null,
    brief: toBrief(output.musique),
    track: track ? { title: track.titre, url: track.url, license: track.licence, source: track.source === "manuel" ? "Choisie à la main" : `Banque : ${track.fournisseur}` } : null,
    effects: output.effets.map((effect) => ({ time: formatSeconds(effect.t_s), effect: effect.effet, plan: effect.plan })),
    mix: `${decimal(output.mixage.cible_lufs)} LUFS · musique ${decimal(output.mixage.musique_sous_voix_db)} dB sous la voix · ${output.mixage.ducking ? "baisse pendant la parole" : "sans baisse"}`,
    proposedCuts: output.coupes_si_trop_long,
    editable,
  };
}

function toVoiceView(production: NonNullable<ReturnType<typeof parseStoredAudioPlan>>["production"]): VoiceView {
  const { voix } = production;
  const [minS, maxS] = production.duree_cible_s;
  return {
    url: voix.url,
    seconds: formatSeconds(voix.duree_s),
    durationLabel: `${formatSeconds(voix.duree_s)} mesurées (estimation ${formatSeconds(production.duree_estimee_s)})`,
    inTarget: durationVerdict(voix.duree_s, { minS, maxS }) === "ok",
    timingLabel: `${voix.mots.length} mots horodatés (${voix.horodatage === "stt" ? "Whisper" : "moteur TTS"})`,
    attemptLabel: `${voix.fournisseur} · voix ${voix.voix_id} · tentative ${voix.tentative}`,
    appliedCuts: voix.coupes_appliquees,
  };
}

function toBrief(music: Output["musique"]): AudioView["brief"] {
  return {
    mood: music.ambiance,
    bpm: `${music.bpm} BPM`,
    instruments: music.instruments.join(", "),
    evolution: music.evolution,
    keywords: music.mots_cles_recherche.join(", "),
    license: music.licence_requise,
  };
}

function toStatus(row: Pick<AudioRow, "stage" | "blockedAt" | "blockedReason">, saved: boolean): AudioStatus {
  if (row.stage === "NEEDS_FIX") {
    const where = row.blockedAt ? ` (${stageLabels[row.blockedAt]})` : "";
    return { label: `À corriger${where}`, tone: "wait", notice: row.blockedReason ?? "Vidéo bloquée : ouvre-la dans Validations." };
  }
  if (row.stage === "VISUALS_AND_AUDIO") {
    if (saved) return { label: "Son prêt · attend le storyboard", tone: "run", notice: null };
    return { label: "Son en préparation", tone: "run", notice: null };
  }
  return { label: stageLabels[row.stage], tone: "ok", notice: null };
}
