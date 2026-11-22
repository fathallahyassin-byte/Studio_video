import { getDb } from "@/lib/db";
import { Prisma, type PrismaClient, type Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { blockVideo, completeStage, type Actor } from "@/lib/pipeline/service";
import type { GenerationRecord, MediaPorts, VisualTools } from "./generation";
import type { Output } from "./schema";
import type { RawBudgets } from "./variables";

// Accès à la base, au pipeline, aux budgets et aux générateurs. Remplacés par des faux dans les tests.

export type StoryboardVideo = {
  stage: Stage;
  blockedAt: Stage | null;
  script: unknown;
  /** storyboard en cours (effacé quand la vidéo revient en VISUALS_AND_AUDIO) */
  storyboard: unknown;
  /** dernière sortie acceptée de l'agent 5 pour cette vidéo : base d'une correction (renvoi V3, reprise) */
  previousStoryboard: unknown;
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
const ART_DIRECTOR_ID = 5;

/**
 * Générateurs branchés. Aucun fournisseur d'images ni de vidéo IA n'existe encore dans lib/providers
 * (étape 5 de la feuille de route) : à brancher ici, avec l'accord du propriétaire (fournisseur payant).
 */
export function configuredVisualTools(): VisualTools {
  return { image: null, video: null };
}

/** Médias générés en base : un Asset par génération, unique par clé, et son coût ajouté à la vidéo. */
export function createPrismaMediaPorts(db: PrismaClient, tools: VisualTools): MediaPorts {
  return {
    tools,
    async findGeneration(key) {
      return db.asset.findUnique({ where: { generationKey: key }, select: { url: true } });
    },
    async countGenerations(videoId, planId) {
      return db.asset.count({ where: { videoId, planId, type: { in: ["IMAGE", "VIDEO"] } } });
    },
    async recordGeneration(record) {
      await recordGeneratedAsset(db, record);
    },
  };
}

/** Une clé déjà enregistrée (deux workers, reprise) n'ajoute ni Asset ni coût : la transaction est annulée. */
async function recordGeneratedAsset(db: PrismaClient, record: GenerationRecord): Promise<void> {
  try {
    await db.$transaction([
      db.asset.create({
        data: {
          videoId: record.videoId,
          type: record.kind,
          url: record.media.url,
          provider: record.provider,
          license: record.media.license,
          planId: record.planId,
          durationS: record.durationS,
          generationKey: record.key,
        },
      }),
      db.video.update({ where: { id: record.videoId }, data: { totalCost: { increment: record.media.cost } } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

export function readRawBudgets(env: Record<string, string | undefined> = process.env): RawBudgets {
  return { videoAiSeconds: env.BUDGET_SECONDES_VIDEO_IA, perVideo: env.BUDGET_PAR_VIDEO };
}

async function loadPreviousStoryboard(db: PrismaClient, videoId: string): Promise<unknown> {
  const run = await db.agentRun.findFirst({
    where: { videoId, agentId: ART_DIRECTOR_ID, status: "OK" },
    orderBy: { createdAt: "desc" },
    select: { output: true },
  });
  return run?.output ?? null;
}

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaStoryboardPorts(): StoryboardPorts {
  const db = getDb();
  return {
    async loadVideo(videoId) {
      const video = await db.video.findUnique({
        where: { id: videoId },
        select: { stage: true, blockedAt: true, scriptJson: true, storyboardJson: true, totalCost: true },
      });
      if (!video) return null;
      return {
        stage: video.stage,
        blockedAt: video.blockedAt,
        script: video.scriptJson,
        storyboard: video.storyboardJson,
        previousStoryboard: await loadPreviousStoryboard(db, videoId),
        totalCost: video.totalCost.toNumber(),
      };
    },
    async saveStoryboard(videoId, storyboard) {
      await db.video.update({ where: { id: videoId }, data: { storyboardJson: toInputJson(storyboard) } });
    },
    async completeMedia(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "MEDIA_DONE", actor: ART_DIRECTOR_ACTOR });
    },
    async blockVideo(videoId, reason) {
      await blockVideo(getPipelineDeps(), { videoId, reason, actor: ART_DIRECTOR_ACTOR });
    },
    budgets: () => readRawBudgets(),
    media: createPrismaMediaPorts(db, configuredVisualTools()),
  };
}
