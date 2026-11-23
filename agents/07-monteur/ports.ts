import { getDb } from "@/lib/db";
import type { Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { blockVideo, completeStage, requestRender, type Actor, type RenderRequest } from "@/lib/pipeline/service";
import type { Output } from "./schema";

// Accès à la base et au pipeline. Remplacés par des faux dans les tests.

export type EditVideo = {
  stage: Stage;
  blockedAt: Stage | null;
  storyboard: unknown;
  audio: unknown;
  /** timeline précédente (renvoi depuis V3, reprise) */
  timeline: unknown;
};

export type EditAssetType = "IMAGE" | "VIDEO" | "VOICE" | "MUSIC" | "RENDER";

/** Un fichier enregistré pour la vidéo ; les listes sont triées du plus récent au plus ancien. */
export type EditAsset = {
  type: EditAssetType;
  url: string;
  planId: string | null;
  durationS: number | null;
  license: string | null;
};

export type EditPorts = {
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<EditVideo | null>;
  loadAssets(videoId: string): Promise<EditAsset[]>;
  saveTimeline(videoId: string, timeline: Output): Promise<void>;
  /** EDIT → RENDER (la tâche de rendu est créée par le pipeline) */
  completeEdit(videoId: string): Promise<void>;
  /** NEEDS_FIX et alerte de l'humain */
  blockVideo(videoId: string, reason: string): Promise<void>;
  /** « Lancer le rendu » : tâche RENDER remise en file (une seule active à la fois) */
  queueRender(videoId: string): Promise<RenderRequest>;
};

export const EDITOR_ACTOR: Actor = { kind: "agent", agentId: 7 };

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaEditPorts(): EditPorts {
  return {
    async loadVideo(videoId) {
      const video = await getDb().video.findUnique({
        where: { id: videoId },
        select: { stage: true, blockedAt: true, storyboardJson: true, audioJson: true, timelineJson: true },
      });
      if (!video) return null;
      return { stage: video.stage, blockedAt: video.blockedAt, storyboard: video.storyboardJson, audio: video.audioJson, timeline: video.timelineJson };
    },
    async loadAssets(videoId) {
      return getDb().asset.findMany({
        where: { videoId },
        orderBy: { createdAt: "desc" },
        select: { type: true, url: true, planId: true, durationS: true, license: true },
      });
    },
    async saveTimeline(videoId, timeline) {
      await getDb().video.update({ where: { id: videoId }, data: { timelineJson: toInputJson(timeline) } });
    },
    async completeEdit(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "EDIT_DONE", actor: EDITOR_ACTOR });
    },
    async blockVideo(videoId, reason) {
      await blockVideo(getPipelineDeps(), { videoId, reason, actor: EDITOR_ACTOR });
    },
    async queueRender(videoId) {
      return requestRender(getPipelineDeps(), videoId);
    },
  };
}
