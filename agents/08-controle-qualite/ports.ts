import { getDb } from "@/lib/db";
import type { AssetType, Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { blockVideo, completeStage, type Actor } from "@/lib/pipeline/service";
import type { Output } from "./schema";

// Accès à la base et au pipeline dont l'agent 8 a besoin. Remplacés par des faux dans les tests.

export type QaVideo = {
  stage: Stage;
  idea: unknown;
  dossier: unknown;
  script: unknown;
  storyboard: unknown;
  audio: unknown;
  timeline: unknown;
  partnership: string;
  /** qaJson actuel : rapport précédent quand la vidéo revient de V3 */
  previousReport: unknown;
};

export type QaAsset = { type: AssetType; provider: string; license: string | null; planId: string | null };

/** Ce qui se mesure sur le rendu final ; null tant que le pipeline ne le produit pas (voir NEEDS.md). */
export type RenderEvidence = { transcription: string | null; captures: string[] | null };

export type PublishedVideo = { number: number; title: string; script: unknown; storyboard: unknown };

export const HISTORY_LIMIT = 10;

export type QaPorts = {
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<QaVideo | null>;
  loadAssets(videoId: string): Promise<QaAsset[]>;
  loadRenderEvidence(videoId: string): Promise<RenderEvidence>;
  /** dernières vidéos publiées de la chaîne, de la plus récente à la plus ancienne */
  loadPublishedVideos(channelId: string, limit: number): Promise<PublishedVideo[]>;
  saveReport(videoId: string, report: Output): Promise<void>;
  /** QA → AWAITING_V3, et prévient l'humain */
  passQa(videoId: string): Promise<void>;
  /** QA → NEEDS_FIX avec la raison, et prévient l'humain */
  blockQa(videoId: string, reason: string): Promise<void>;
};

export const QA_ACTOR: Actor = { kind: "agent", agentId: 8 };

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaQaPorts(): QaPorts {
  return {
    async loadVideo(videoId) {
      const video = await getDb().video.findUnique({
        where: { id: videoId },
        select: { stage: true, ideaJson: true, dossierJson: true, scriptJson: true, storyboardJson: true, audioJson: true, timelineJson: true, partnership: true, qaJson: true },
      });
      if (!video) return null;
      return {
        stage: video.stage,
        idea: video.ideaJson,
        dossier: video.dossierJson,
        script: video.scriptJson,
        storyboard: video.storyboardJson,
        audio: video.audioJson,
        timeline: video.timelineJson,
        partnership: video.partnership,
        previousReport: video.qaJson,
      };
    },
    async loadAssets(videoId) {
      return getDb().asset.findMany({ where: { videoId }, orderBy: { createdAt: "asc" }, select: { type: true, provider: true, license: true, planId: true } });
    },
    async loadRenderEvidence() {
      // Ni transcription Whisper ni captures ne sont encore enregistrées par le pipeline (NEEDS.md, point 1).
      return { transcription: null, captures: null };
    },
    async loadPublishedVideos(channelId, limit) {
      const videos = await getDb().video.findMany({
        where: { channelId, stage: "PUBLISHED" },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: { number: true, title: true, scriptJson: true, storyboardJson: true },
      });
      return videos.map((video) => ({ number: video.number, title: video.title, script: video.scriptJson, storyboard: video.storyboardJson }));
    },
    async saveReport(videoId, report) {
      await getDb().video.update({ where: { id: videoId }, data: { qaJson: toInputJson(report) } });
    },
    async passQa(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "QA_PASSED", actor: QA_ACTOR });
    },
    async blockQa(videoId, reason) {
      await blockVideo(getPipelineDeps(), { videoId, reason, actor: QA_ACTOR });
    },
  };
}
