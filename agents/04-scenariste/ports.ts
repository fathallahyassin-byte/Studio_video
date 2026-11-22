import { getDb } from "@/lib/db";
import { Prisma, type Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { completeStage, type Actor } from "@/lib/pipeline/service";
import type { Output } from "./schema";

// Accès à la base et au pipeline dont l'agent 4 a besoin. Remplacés par des faux dans les tests.

export type ScriptVideo = { stage: Stage; idea: unknown; dossier: unknown; script: unknown };

export const PUBLISHED_SCRIPTS_LIMIT = 5;

export type ScriptPorts = {
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<ScriptVideo | null>;
  /** contenu du dernier AnalystReport de la chaîne, null s'il n'y en a pas */
  loadLatestReport(channelId: string): Promise<unknown>;
  /** scriptJson des dernières vidéos publiées de la chaîne, de la plus récente à la plus ancienne */
  loadPublishedScripts(channelId: string, limit: number): Promise<unknown[]>;
  saveScript(videoId: string, script: Output): Promise<void>;
  /** SCRIPT → AWAITING_V2, et prévient l'humain */
  completeScript(videoId: string): Promise<void>;
};

export const SCRIPT_ACTOR: Actor = { kind: "agent", agentId: 4 };

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaScriptPorts(): ScriptPorts {
  return {
    async loadVideo(videoId) {
      const video = await getDb().video.findUnique({ where: { id: videoId }, select: { stage: true, ideaJson: true, dossierJson: true, scriptJson: true } });
      return video ? { stage: video.stage, idea: video.ideaJson, dossier: video.dossierJson, script: video.scriptJson } : null;
    },
    async loadLatestReport(channelId) {
      const report = await getDb().analystReport.findFirst({ where: { channelId }, orderBy: { createdAt: "desc" }, select: { content: true } });
      return report?.content ?? null;
    },
    async loadPublishedScripts(channelId, limit) {
      const videos = await getDb().video.findMany({
        where: { channelId, stage: "PUBLISHED", scriptJson: { not: Prisma.DbNull } },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: { scriptJson: true },
      });
      return videos.map((video) => video.scriptJson);
    },
    async saveScript(videoId, script) {
      await getDb().video.update({ where: { id: videoId }, data: { scriptJson: toInputJson(script) } });
    },
    async completeScript(videoId) {
      await completeStage(getPipelineDeps(), { videoId, event: "SCRIPT_DONE", actor: SCRIPT_ACTOR });
    },
  };
}
