import { getDb } from "@/lib/db";
import type { Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { blockVideo, completeStage, type Actor } from "@/lib/pipeline/service";
import type { MediaPorts, VisualTools } from "./generation";
import type { Output } from "./schema";
import type { RawBudgets } from "./variables";

// Accès à la base, au pipeline, aux budgets et aux générateurs. Remplacés par des faux dans les tests.

export type StoryboardVideo = {
  stage: Stage;
  blockedAt: Stage | null;
  script: unknown;
  storyboard: unknown;
  /** ce que la vidéo a déjà coûté (AgentRun et générations), dans la monnaie des budgets */
  totalCost: number;
};

export type StoryboardPorts = {
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<StoryboardVideo | null>;
  saveStoryboard(videoId: string, storyboard: Output): Promise<void>;
  /** VISUALS_AND_AUDIO → EDIT, seulement quand le plan sonore (agent 6) est là aussi */
  completeMedia(videoId: string): Promise<void>;
  /** NEEDS_FIX et alerte de l'humain */
  blockVideo(videoId: string, reason: string): Promise<void>;
  budgets(): RawBudgets;
  media: MediaPorts;
};

export const ART_DIRECTOR_ACTOR: Actor = { kind: "agent", agentId: 5 };

/**
 * Générateurs branchés. Aucun fournisseur d'images ni de vidéo IA n'existe encore dans lib/providers
 * (étape 5 de la feuille de route) : la session principale les ajoutera ici (voir NEEDS.md).
 */
export function configuredVisualTools(): VisualTools {
  return { image: null, video: null };
}

/**
 * Médias sans fournisseur : rien à retrouver ni à enregistrer. `recordGeneration` n'est jamais atteint
 * tant qu'aucun générateur n'est branché ; il demande la clé unique sur Asset décrite dans NEEDS.md.
 */
export function createUnconfiguredMediaPorts(): MediaPorts {
  return {
    tools: configuredVisualTools(),
    async findGeneration() {
      return null;
    },
    async countGenerations(videoId, planId) {
      return getDb().asset.count({ where: { videoId, planId, type: { in: ["IMAGE", "VIDEO"] } } });
    },
    async recordGeneration() {
      throw new Error("Enregistrement des médias générés non branché : il faut Asset.generationKey (voir agents/05-directeur-artistique/NEEDS.md).");
    },
  };
}

export function readRawBudgets(env: Record<string, string | undefined> = process.env): RawBudgets {
  return { videoAiSeconds: env.BUDGET_SECONDES_VIDEO_IA, perVideo: env.BUDGET_PAR_VIDEO };
}

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaStoryboardPorts(): StoryboardPorts {
  return {
    async loadVideo(videoId) {
      const video = await getDb().video.findUnique({
        where: { id: videoId },
        select: { stage: true, blockedAt: true, scriptJson: true, storyboardJson: true, totalCost: true },
      });
      if (!video) return null;
      return { stage: video.stage, blockedAt: video.blockedAt, script: video.scriptJson, storyboard: video.storyboardJson, totalCost: video.totalCost.toNumber() };
    },
    async saveStoryboard(videoId, storyboard) {
      await getDb().video.update({ where: { id: videoId }, data: { storyboardJson: toInputJson(storyboard) } });
    },
    async completeMedia(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "MEDIA_DONE", actor: ART_DIRECTOR_ACTOR });
    },
    async blockVideo(videoId, reason) {
      await blockVideo(getPipelineDeps(), { videoId, reason, actor: ART_DIRECTOR_ACTOR });
    },
    budgets: () => readRawBudgets(),
    media: createUnconfiguredMediaPorts(),
  };
}
