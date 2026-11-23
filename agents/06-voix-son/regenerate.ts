import type { Stage } from "@/lib/generated/prisma/client";
import { parseStoredAudioPlan, type AudioPlan, type TrackJson } from "./audioPlan";
import { hasLicense } from "./music";
import type { EditRestart } from "@/lib/pipeline/service";
import { MANUAL_PROVIDER, type AudioPorts, type AudioVideo } from "./ports";
import { checkTtsText, durationVerdict, roundTenth, spokenWords } from "./rules";
import { parseAmount, ttsTagNames } from "./variables";
import { produceVoice, voiceRefusal, type VoiceOutcome } from "./voice";

// Actions de l'humain depuis le panneau : « Régénérer la voix » avec le texte modifié, et choix d'une piste sous licence.

export type EditResult = { ok: boolean; message: string };

/** Avant le rendu : visuels et son en cours, montage, ou vidéo bloquée à l'une de ces étapes. */
const EDITABLE_STAGES: readonly Stage[] = ["VISUALS_AND_AUDIO", "EDIT"];

export function canEditAt(video: Pick<AudioVideo, "stage" | "blockedAt">): boolean {
  if (EDITABLE_STAGES.includes(video.stage)) return true;
  return video.stage === "NEEDS_FIX" && video.blockedAt !== null && EDITABLE_STAGES.includes(video.blockedAt);
}

const NOT_EDITABLE = "Le son ne se modifie qu'avant le rendu (visuels et son, montage, ou vidéo bloquée à ces étapes).";

export async function regenerateVoice(ports: AudioPorts, input: { videoId: string; text: string }): Promise<EditResult> {
  const video = await ports.loadVideo(input.videoId);
  if (!video) return { ok: false, message: "Vidéo introuvable." };
  if (!canEditAt(video)) return { ok: false, message: NOT_EDITABLE };
  const plan = parseStoredAudioPlan(video.audio);
  if (!plan) return { ok: false, message: "Le plan sonore n'est pas encore enregistré : la première voix se génère à l'étape Visuels et son (relance l'étape si la vidéo est bloquée)." };
  const { tts, stt } = ports.tools;
  if (!tts) return { ok: false, message: "Aucun moteur de synthèse vocale n'est branché." };
  const text = input.text.trim();
  const refusals = checkTtsText(text, ttsTagNames(tts)).flatMap((result) => (result.ok ? [] : [result.reason]));
  if (refusals.length > 0) return { ok: false, message: refusals.join(" ") };

  const attempt = (await ports.voices.countVoices(input.videoId)) + 1;
  const perVideo = parseAmount(ports.budgets().perVideo);
  const outcome = await produceVoice(ports.voices, { tts, stt }, {
    videoId: input.videoId,
    text,
    voiceId: plan.production.voix.voix_id,
    language: plan.production.voix.langue,
    attempt,
    remainingBudget: perVideo === null ? null : perVideo - video.totalCost,
    isStillActive: async () => {
      const current = await ports.loadVideo(input.videoId);
      return current !== null && canEditAt(current);
    },
  });
  if (outcome.status === "stopped") return { ok: false, message: "La vidéo a changé d'étape : régénération annulée." };
  if (outcome.status !== "done") return { ok: false, message: capitalize(voiceRefusal(outcome)) };
  await ports.saveAudioPlan(input.videoId, withVoice(plan, text, outcome, attempt));
  const restart = await ports.soundChanged(input.videoId);
  return { ok: true, message: `${regeneratedMessage(plan, outcome.voice.durationS, attempt)}${restartNote(restart)}` };
}

function withVoice(plan: AudioPlan, text: string, outcome: Extract<VoiceOutcome, { status: "done" }>, attempt: number): AudioPlan {
  const { production } = plan;
  const rate = production.duree_estimee_s / Math.max(spokenWords(plan.texte_tts), 1);
  const { voice } = outcome;
  return {
    ...plan,
    texte_tts: text,
    production: {
      ...production,
      duree_estimee_s: roundTenth(rate * spokenWords(text)),
      voix: {
        ...production.voix,
        url: voice.url,
        fournisseur: voice.provider,
        duree_s: voice.durationS,
        mots: voice.words,
        horodatage: voice.timingSource ?? "tts",
        coupes_appliquees: [],
        tentative: attempt,
      },
    },
  };
}

function regeneratedMessage(plan: AudioPlan, durationS: number, attempt: number): string {
  const [minS, maxS] = plan.production.duree_cible_s;
  const verdict = durationVerdict(durationS, { minS, maxS });
  const duration = `${String(roundTenth(durationS)).replace(".", ",")} s`;
  if (verdict === "ok") return `Voix régénérée (tentative ${attempt}) : ${duration}.`;
  return `Voix régénérée (tentative ${attempt}) : ${duration}, hors de la cible de ${minS} à ${maxS} s. Ajuste le texte et régénère.`;
}

/** Au montage, une timeline déjà produite gardait l'ancien son : elle est refaite. */
function restartNote(restart: EditRestart): string {
  if (restart === "restarted") return " Le montage est relancé avec ce son.";
  if (restart === "cleared") return " La timeline est effacée : relance l'étape pour refaire le montage.";
  return "";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type MusicChoice = { videoId: string; title: string; url: string; license: string };

/** Piste choisie par l'humain : Asset MUSIC avec sa licence (obligatoire), et plan sonore mis à jour s'il existe. */
export async function chooseMusic(ports: AudioPorts, input: MusicChoice): Promise<EditResult> {
  if (!hasLicense(input.license)) return { ok: false, message: "La licence est obligatoire : sans elle, la piste n'est pas enregistrée." };
  const video = await ports.loadVideo(input.videoId);
  if (!video) return { ok: false, message: "Vidéo introuvable." };
  if (!canEditAt(video)) return { ok: false, message: NOT_EDITABLE };
  const track: TrackJson = { titre: input.title.trim(), url: input.url.trim(), fournisseur: MANUAL_PROVIDER, licence: input.license.trim(), source: "manuel" };
  await ports.music.recordTrack(input.videoId, track, 0);
  const plan = parseStoredAudioPlan(video.audio);
  if (!plan) return { ok: true, message: `Piste « ${track.titre} » enregistrée. Relance l'étape pour terminer le plan sonore : elle sera utilisée.` };
  await ports.saveAudioPlan(input.videoId, { ...plan, production: { ...plan.production, musique: track } });
  const restart = await ports.soundChanged(input.videoId);
  return { ok: true, message: `Piste « ${track.titre} » enregistrée dans le plan sonore.${restartNote(restart)}` };
}
