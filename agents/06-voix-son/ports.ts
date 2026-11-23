import { getDb } from "@/lib/db";
import type { Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { blockVideo, completeStage, restartEdit, type Actor, type EditRestart } from "@/lib/pipeline/service";
import { parseStoredOutput, type AudioPlan, type TrackJson } from "./audioPlan";
import { assertLicensed, type MusicLibrary, type MusicStore } from "./music";
import type { Output } from "./schema";
import type { VoiceStore, VoiceTools } from "./voice";

// Accès à la base, au pipeline, au budget et aux fournisseurs. Remplacés par des faux dans les tests.

export type AudioVideo = {
  stage: Stage;
  blockedAt: Stage | null;
  script: unknown;
  storyboard: unknown;
  audio: unknown;
  /** ce que la vidéo a déjà coûté (AgentRun et générations), dans la monnaie des budgets */
  totalCost: number;
};

export type AudioTools = VoiceTools & { music: MusicLibrary | null };

export type AudioPorts = {
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<AudioVideo | null>;
  /** dernier plan du modèle pour la vidéo : audioJson, sinon la sortie du dernier AgentRun réussi de l'agent 6 */
  loadLatestOutput(videoId: string): Promise<Output | null>;
  saveAudioPlan(videoId: string, plan: AudioPlan): Promise<void>;
  /** VISUALS_AND_AUDIO → EDIT, seulement quand le storyboard (agent 5) est là aussi */
  completeMedia(videoId: string): Promise<void>;
  /** NEEDS_FIX et alerte de l'humain */
  blockVideo(videoId: string, reason: string): Promise<void>;
  /** le son a changé au montage : timeline effacée, monteur relancé (restartEdit de lib/pipeline) */
  soundChanged(videoId: string): Promise<EditRestart>;
  budgets(): { perVideo: string | undefined };
  tools: AudioTools;
  voices: VoiceStore;
  music: MusicStore;
};

export const VOICE_ACTOR: Actor = { kind: "agent", agentId: 6 };
export const MANUAL_PROVIDER = "choix manuel";

/**
 * Fournisseurs branchés. Aucun moteur TTS, aucun Whisper ni aucune banque de musique n'existe encore
 * dans lib/providers (étape 5 de la feuille de route) : la session principale les ajoutera ici (voir NEEDS.md).
 */
export function configuredAudioTools(): AudioTools {
  return { tts: null, stt: null, music: null };
}

/**
 * Voix sans fournisseur : rien à retrouver. `recordVoice` et `recordTimings` ne sont jamais atteints tant
 * qu'aucun TTS n'est branché ; ils demandent la clé unique et l'horodatage sur Asset décrits dans NEEDS.md.
 */
export function createUnconfiguredVoiceStore(): VoiceStore {
  const missing = () => new Error("Enregistrement des voix générées non branché : il faut Asset.generationKey et l'horodatage (voir agents/06-voix-son/NEEDS.md).");
  return {
    async findVoice() {
      return null;
    },
    async countVoices(videoId) {
      return getDb().asset.count({ where: { videoId, type: "VOICE" } });
    },
    async recordVoice() {
      throw missing();
    },
    async recordTimings() {
      throw missing();
    },
  };
}

/** « choix manuel · Titre » : le titre saisi par l'humain reste lisible dans Asset.provider. */
export function manualProvider(title: string): string {
  return `${MANUAL_PROVIDER} · ${title.trim()}`;
}

export function manualTitle(provider: string, url: string): string {
  const title = provider.startsWith(`${MANUAL_PROVIDER} · `) ? provider.slice(MANUAL_PROVIDER.length + 3).trim() : "";
  return title || url.split("/").at(-1) || url;
}

export function createPrismaMusicStore(): MusicStore {
  return {
    async findManualChoice(videoId) {
      const asset = await getDb().asset.findFirst({
        where: { videoId, type: "MUSIC", provider: { startsWith: MANUAL_PROVIDER } },
        orderBy: { createdAt: "desc" },
        select: { url: true, provider: true, license: true },
      });
      if (!asset?.license?.trim()) return null;
      return { titre: manualTitle(asset.provider, asset.url), url: asset.url, fournisseur: MANUAL_PROVIDER, licence: asset.license.trim(), source: "manuel" };
    },
    async recordTrack(videoId, track, cost) {
      await recordMusicAsset(videoId, track, cost);
    },
  };
}

/** Asset MUSIC, une seule fois par URL et par vidéo ; jamais sans licence. */
export async function recordMusicAsset(videoId: string, track: TrackJson, cost: number): Promise<void> {
  assertLicensed(track);
  const provider = track.source === "manuel" ? manualProvider(track.titre) : track.fournisseur;
  await getDb().$transaction(async (tx) => {
    const existing = await tx.asset.findFirst({ where: { videoId, type: "MUSIC", url: track.url, provider }, select: { id: true } });
    if (existing) return;
    await tx.asset.create({ data: { videoId, type: "MUSIC", url: track.url, provider, license: track.licence.trim() } });
    if (cost > 0) await tx.video.update({ where: { id: videoId }, data: { totalCost: { increment: cost } } });
  });
}

export function readBudgets(env: Record<string, string | undefined> = process.env): { perVideo: string | undefined } {
  return { perVideo: env.BUDGET_PAR_VIDEO };
}

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaAudioPorts(): AudioPorts {
  return {
    async loadVideo(videoId) {
      const video = await getDb().video.findUnique({
        where: { id: videoId },
        select: { stage: true, blockedAt: true, scriptJson: true, storyboardJson: true, audioJson: true, totalCost: true },
      });
      if (!video) return null;
      return { stage: video.stage, blockedAt: video.blockedAt, script: video.scriptJson, storyboard: video.storyboardJson, audio: video.audioJson, totalCost: video.totalCost.toNumber() };
    },
    async loadLatestOutput(videoId) {
      return loadLatestOutput(videoId);
    },
    async saveAudioPlan(videoId, plan) {
      await getDb().video.update({ where: { id: videoId }, data: { audioJson: toInputJson(plan) } });
    },
    async completeMedia(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "MEDIA_DONE", actor: VOICE_ACTOR });
    },
    async blockVideo(videoId, reason) {
      await blockVideo(getPipelineDeps(), { videoId, reason, actor: VOICE_ACTOR });
    },
    async soundChanged(videoId) {
      return restartEdit(getPipelineDeps(), videoId);
    },
    budgets: () => readBudgets(),
    tools: configuredAudioTools(),
    voices: createUnconfiguredVoiceStore(),
    music: createPrismaMusicStore(),
  };
}

async function loadLatestOutput(videoId: string): Promise<Output | null> {
  const db = getDb();
  const video = await db.video.findUnique({ where: { id: videoId }, select: { audioJson: true } });
  // outputSchema retire le bloc production (horodatage compris) : seule la sortie du modèle est renvoyée.
  const saved = parseStoredOutput(video?.audioJson ?? null);
  if (saved) return saved;
  const run = await db.agentRun.findFirst({ where: { videoId, agentId: 6, status: "OK" }, orderBy: { createdAt: "desc" }, select: { output: true } });
  return parseStoredOutput(run?.output ?? null);
}
