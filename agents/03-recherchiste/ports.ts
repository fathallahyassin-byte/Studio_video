import { getDb } from "@/lib/db";
import type { Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { blockVideo, completeStage, type Actor } from "@/lib/pipeline/service";
import type { Output } from "./schema";

// Accès à la base et au pipeline dont l'agent 3 a besoin. Remplacés par des faux dans les tests.

export type ResearchVideo = { stage: Stage; idea: unknown };

export type ResearchPorts = {
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<ResearchVideo | null>;
  /** liens ajoutés par l'humain pour cette vidéo (aucun champ en base pour l'instant : voir NEEDS.md) */
  loadHumanSources(videoId: string): Promise<string[]>;
  saveDossier(videoId: string, dossier: Output): Promise<void>;
  /** RESEARCH → SCRIPT : lance le scénariste */
  completeResearch(videoId: string): Promise<void>;
  /** RESEARCH → NEEDS_FIX, et prévient l'humain */
  block(videoId: string, reason: string): Promise<void>;
};

const actor: Actor = { kind: "agent", agentId: 3 };

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaResearchPorts(): ResearchPorts {
  return {
    async loadVideo(videoId) {
      const video = await getDb().video.findUnique({ where: { id: videoId }, select: { stage: true, ideaJson: true } });
      return video ? { stage: video.stage, idea: video.ideaJson } : null;
    },
    async loadHumanSources() {
      return [];
    },
    async saveDossier(videoId, dossier) {
      await getDb().video.update({ where: { id: videoId }, data: { dossierJson: toInputJson(dossier) } });
    },
    async completeResearch(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "RESEARCH_DONE", actor });
    },
    async block(videoId, reason) {
      await blockVideo(getPipelineDeps(), { videoId, reason, actor });
    },
  };
}
