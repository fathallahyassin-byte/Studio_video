import type { AudioPlan, TrackJson } from "./audioPlan";
import { resolveMusic, type MusicResolution } from "./music";
import type { AudioPorts, AudioVideo } from "./ports";
import { estimateVoiceS } from "./rules";
import type { Output } from "./schema";
import { parseAmount, type AudioSettings } from "./variables";
import { fitVoice, formatMoney, type FittedVoice } from "./voice";

// Après une sortie acceptée : musique choisie (avec licence), voix générée et mesurée, horodatage récupéré.
// Tout ce qui manque est vérifié AVANT de payer quoi que ce soit ; le plan n'est complet que si tout est réglé.

export const BLOCK_PREFIX = "Voix et son : ";
export const NO_TTS_REASON =
  "aucun moteur de synthèse vocale n'est branché : le plan sonore est prêt (panneau Voix et son) mais la voix n'a pas été générée. Branche un TTS, puis relance l'étape.";
export const NO_VOICE_ID_REASON = "identite.voix n'est pas renseignée dans la bible (« moteur / id de la voix ») : aucune voix à utiliser.";

export type SoundtrackOutcome = { status: "ok"; plan: AudioPlan } | { status: "blocked"; reason: string } | { status: "stopped" };

export type SoundtrackInput = {
  videoId: string;
  video: AudioVideo;
  output: Output;
  settings: AudioSettings;
  isStillActive(): Promise<boolean>;
};

const blocked = (reasons: readonly string[]): SoundtrackOutcome => ({ status: "blocked", reason: `${BLOCK_PREFIX}${reasons.join(" ; ")}` });

export async function produceSoundtrack(ports: AudioPorts, input: SoundtrackInput): Promise<SoundtrackOutcome> {
  const { output, settings, videoId } = input;
  const estimatedS = estimateVoiceS(output.texte_tts, settings.target.wordsPerSecond);
  const music = await resolveMusic(ports.music, ports.tools.music, { videoId, brief: output.musique, minDurationS: estimatedS });
  const { tts, stt } = ports.tools;
  const { voiceId } = settings;
  if (!tts || !voiceId || music.status === "missing") {
    return blocked([tts ? null : NO_TTS_REASON, voiceId ? null : NO_VOICE_ID_REASON, music.status === "missing" ? music.reason : null].filter((reason) => reason !== null));
  }

  const budget = remainingAfterMusic(ports, input.video, music);
  if (budget.status === "refused") return blocked([budget.reason]);
  const fit = await fitVoice(ports.voices, { tts, stt }, {
    videoId,
    text: output.texte_tts,
    voiceId,
    language: settings.language,
    attempt: 1,
    remainingBudget: budget.remaining,
    isStillActive: input.isStillActive,
    expectedDurationS: settings.target.maxS,
    cuts: output.coupes_si_trop_long,
    target: settings.target,
  });
  if (fit.status === "stopped") return fit;
  if (fit.status === "refused") return blocked([fit.reason]);

  if (music.status === "library") await ports.music.recordTrack(videoId, music.track, music.cost);
  return { status: "ok", plan: buildAudioPlan(output, fit.fitted, music.track, settings) };
}

type BudgetCheck = { status: "ok"; remaining: number | null } | { status: "refused"; reason: string };

/** BUDGET_PAR_VIDEO moins ce que la vidéo a coûté et le prix de la piste choisie (CLAUDE.md §5.7). */
function remainingAfterMusic(ports: AudioPorts, video: AudioVideo, music: Exclude<MusicResolution, { status: "missing" }>): BudgetCheck {
  const perVideo = parseAmount(ports.budgets().perVideo);
  const musicCost = music.status === "library" ? music.cost : 0;
  if (perVideo === null) {
    return musicCost > 0 ? { status: "refused", reason: "BUDGET_PAR_VIDEO est absent ou invalide dans .env : piste payante refusée." } : { status: "ok", remaining: null };
  }
  const remaining = perVideo - video.totalCost - musicCost;
  if (remaining < 0) return { status: "refused", reason: `piste estimée à ${formatMoney(musicCost)}, il reste ${formatMoney(perVideo - video.totalCost)} sur le budget de la vidéo.` };
  return { status: "ok", remaining };
}

export function buildAudioPlan(output: Output, fitted: FittedVoice, track: TrackJson, settings: AudioSettings, attempt = 1): AudioPlan {
  const { voice } = fitted;
  return {
    ...output,
    texte_tts: fitted.text,
    production: {
      duree_estimee_s: estimateVoiceS(fitted.text, settings.target.wordsPerSecond),
      duree_cible_s: [settings.target.minS, settings.target.maxS],
      voix: {
        url: voice.url,
        fournisseur: voice.provider,
        voix_id: settings.voiceId ?? "",
        langue: settings.language,
        duree_s: voice.durationS,
        mots: voice.words,
        horodatage: voice.timingSource ?? "tts",
        coupes_appliquees: fitted.appliedCuts,
        tentative: attempt,
      },
      musique: track,
    },
  };
}
