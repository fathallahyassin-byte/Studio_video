import { createHash } from "node:crypto";
import type { WordTiming } from "@/lib/providers/media";
import type { SttProvider } from "@/lib/providers/stt";
import type { TtsProvider, TtsRequest } from "@/lib/providers/tts";
import { durationVerdict, planCuts, roundTenth, type DurationTarget } from "./rules";

// Génération de la voix via les interfaces de lib/providers. Idempotente : chaque voix a une clé (vidéo,
// tentative, empreinte de la requête) ; une clé déjà réussie n'est jamais relancée, même après un crash.

export type VoiceTools = { tts: TtsProvider | null; stt: SttProvider | null };

export type StoredVoice = {
  key: string;
  url: string;
  provider: string;
  durationS: number;
  /** null tant que l'horodatage n'est pas récupéré (moteur sans horodatage, Whisper pas encore passé) */
  words: WordTiming[] | null;
  timingSource: "tts" | "stt" | null;
};

export type VoiceRecord = StoredVoice & { videoId: string; attempt: number; text: string; cost: number };

/** Voix générées : Asset VOICE + coût ajouté à la vidéo (branché par la session principale, voir NEEDS.md). */
export type VoiceStore = {
  findVoice(key: string): Promise<StoredVoice | null>;
  /** nombre de voix déjà enregistrées pour la vidéo (tentatives précédentes) */
  countVoices(videoId: string): Promise<number>;
  /** enregistre l'Asset VOICE et ajoute record.cost à Video.totalCost */
  recordVoice(record: VoiceRecord): Promise<void>;
  /** horodatage obtenu après coup (Whisper) ; cost s'ajoute à Video.totalCost */
  recordTimings(key: string, words: WordTiming[], cost: number): Promise<void>;
};

export function voiceKey(videoId: string, attempt: number, request: TtsRequest): string {
  const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 12);
  return `${videoId}:voix:${attempt}:${fingerprint}`;
}

export type VoiceJob = {
  videoId: string;
  text: string;
  voiceId: string;
  language: string;
  attempt: number;
  /** ce qui reste sur BUDGET_PAR_VIDEO ; null si le budget n'est pas configuré */
  remainingBudget: number | null;
  /** relu avant chaque génération payante : faux si la vidéo a quitté l'étape (abandon, blocage) */
  isStillActive(): Promise<boolean>;
  /** durée attendue de la voix, pour estimer Whisper avant de payer ; à défaut, mots ÷ 2 (voix lente) */
  expectedDurationS?: number;
};

export type VoiceOutcome =
  | { status: "done"; voice: StoredVoice & { words: WordTiming[] }; cost: number; reused: boolean }
  | { status: "no_budget" }
  | { status: "over_budget"; estimate: number; remaining: number }
  | { status: "no_timings" }
  | { status: "stopped" };

export function voiceRequest(job: Pick<VoiceJob, "text" | "voiceId">): TtsRequest {
  return { text: job.text, voiceId: job.voiceId, speed: 1 };
}

/** Coût restant à payer pour cette voix : 0 si elle est déjà enregistrée. */
export async function pendingVoiceCost(store: VoiceStore, tts: TtsProvider, job: Pick<VoiceJob, "videoId" | "text" | "voiceId" | "attempt">): Promise<number> {
  const request = voiceRequest(job);
  return (await store.findVoice(voiceKey(job.videoId, job.attempt, request))) ? 0 : tts.estimateCost(request.text);
}

/** Génère (ou retrouve) la voix, puis son horodatage mot à mot : moteur TTS, ou Whisper à défaut. */
export async function produceVoice(store: VoiceStore, tools: { tts: TtsProvider; stt: SttProvider | null }, job: VoiceJob): Promise<VoiceOutcome> {
  const request = voiceRequest(job);
  const key = voiceKey(job.videoId, job.attempt, request);
  const existing = await store.findVoice(key);
  if (existing) return withTimings(store, tools.stt, job, existing, { cost: 0, reused: true });

  // Sans horodatage du moteur ni Whisper, la voix serait payée puis inutilisable : refus avant de payer.
  if (!tools.tts.providesWordTimings && !tools.stt) return { status: "no_timings" };
  const estimate = tools.tts.estimateCost(request.text) + whisperEstimate(tools, job);
  if (estimate > 0 && job.remainingBudget === null) return { status: "no_budget" };
  if (job.remainingBudget !== null && estimate > job.remainingBudget) return { status: "over_budget", estimate, remaining: job.remainingBudget };
  if (!(await job.isStillActive())) return { status: "stopped" };

  const result = await tools.tts.synthesize(request);
  const voice: StoredVoice = { key, url: result.url, provider: tools.tts.name, durationS: result.durationS, words: result.words, timingSource: result.words ? "tts" : null };
  await store.recordVoice({ ...voice, videoId: job.videoId, attempt: job.attempt, text: job.text, cost: result.cost });
  return withTimings(store, tools.stt, job, voice, { cost: result.cost, reused: false });
}

/** Coût de Whisper, compté avant de payer la voix quand le moteur ne donne pas l'horodatage. */
export function whisperEstimate(tools: { tts: TtsProvider; stt: SttProvider | null }, job: Pick<VoiceJob, "text" | "expectedDurationS">): number {
  if (tools.tts.providesWordTimings || !tools.stt) return 0;
  const words = job.text.split(/\s+/).filter((word) => word !== "").length;
  return tools.stt.estimateCost(job.expectedDurationS ?? words / 2);
}

async function withTimings(
  store: VoiceStore,
  stt: SttProvider | null,
  job: VoiceJob,
  voice: StoredVoice,
  spent: { cost: number; reused: boolean },
): Promise<VoiceOutcome> {
  if (voice.words) return { status: "done", voice: { ...voice, words: voice.words }, ...spent };
  if (!stt) return { status: "no_timings" };
  // Whisper passe une fois la voix payée ; son coût a été estimé avec elle (whisperEstimate).
  const transcript = await stt.transcribe({ audioUrl: voice.url, language: job.language });
  await store.recordTimings(voice.key, transcript.words, transcript.cost);
  return { status: "done", voice: { ...voice, words: transcript.words, timingSource: "stt" }, cost: spent.cost + transcript.cost, reused: spent.reused };
}

// ---------------------------------------------------------------------------
// Durée réelle : hors cible, on applique en code les coupes proposées et on régénère une seule fois.
// ---------------------------------------------------------------------------

export type FittedVoice = { voice: StoredVoice & { words: WordTiming[] }; text: string; appliedCuts: string[]; cost: number };

export type FitOutcome = { status: "ok"; fitted: FittedVoice } | { status: "refused"; reason: string } | { status: "stopped" };

export type FitJob = Omit<VoiceJob, "text"> & { text: string; cuts: readonly string[]; target: DurationTarget };

export async function fitVoice(store: VoiceStore, tools: { tts: TtsProvider; stt: SttProvider | null }, job: FitJob): Promise<FitOutcome> {
  const first = await produceVoice(store, tools, job);
  if (first.status !== "done") return refusedOrStopped(first);
  const verdict = durationVerdict(first.voice.durationS, job.target);
  if (verdict === "ok") return { status: "ok", fitted: { voice: first.voice, text: job.text, appliedCuts: [], cost: first.cost } };
  if (verdict === "too_short") return { status: "refused", reason: tooShortReason(first.voice.durationS, job.target) };

  const cuts = planCuts(job.text, job.cuts, { durationS: first.voice.durationS, maxS: job.target.maxS });
  if (cuts.applied.length === 0 || !cuts.reached) return { status: "refused", reason: cutsInsufficientReason(first.voice.durationS, job.target, cuts.estimatedS, job.cuts.length) };

  const remaining = job.remainingBudget === null ? null : job.remainingBudget - first.cost;
  const second = await produceVoice(store, tools, { ...job, text: cuts.text, remainingBudget: remaining });
  if (second.status !== "done") return refusedOrStopped(second);
  if (durationVerdict(second.voice.durationS, job.target) !== "ok") {
    return { status: "refused", reason: `voix coupée encore hors cible : ${seconds(second.voice.durationS)} pour ${range(job.target)} (coupes appliquées : ${cuts.applied.length}). Raccourcis le texte TTS dans le panneau puis régénère la voix, ou relance l'étape avec une note.` };
  }
  return { status: "ok", fitted: { voice: second.voice, text: cuts.text, appliedCuts: cuts.applied, cost: first.cost + second.cost } };
}

const seconds = (value: number) => `${String(roundTenth(value)).replace(".", ",")} s`;
const range = (target: DurationTarget) => `${String(target.minS).replace(".", ",")} à ${String(target.maxS).replace(".", ",")} s`;

function tooShortReason(durationS: number, target: DurationTarget): string {
  return `voix trop courte : ${seconds(durationS)} pour une cible de ${range(target)}. Rallonge le texte TTS dans le panneau puis régénère la voix, ou relance l'étape avec une note.`;
}

function cutsInsufficientReason(durationS: number, target: DurationTarget, estimatedS: number, proposed: number): string {
  if (proposed === 0) return `voix trop longue : ${seconds(durationS)} pour une cible de ${range(target)}, et aucune coupe proposée.`;
  return `voix trop longue : ${seconds(durationS)} pour une cible de ${range(target)} ; même avec les ${proposed} coupe(s) proposée(s), elle durerait environ ${seconds(estimatedS)}. Rien n'a été régénéré.`;
}

export function voiceRefusal(outcome: Exclude<VoiceOutcome, { status: "done" | "stopped" }>): string {
  switch (outcome.status) {
    case "no_budget":
      return "BUDGET_PAR_VIDEO est absent ou invalide dans .env : génération de la voix refusée.";
    case "over_budget":
      return `voix estimée à ${formatMoney(outcome.estimate)}, il reste ${formatMoney(outcome.remaining)} sur le budget de la vidéo. Rien n'a été généré.`;
    case "no_timings":
      return "le moteur TTS ne fournit pas d'horodatage mot à mot et aucun Whisper n'est branché : les sous-titres ne peuvent pas être recalés.";
  }
}

function refusedOrStopped(outcome: Exclude<VoiceOutcome, { status: "done" }>): FitOutcome {
  return outcome.status === "stopped" ? { status: "stopped" } : { status: "refused", reason: voiceRefusal(outcome) };
}

export function formatMoney(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2).replace(".", ",")} €`;
}
