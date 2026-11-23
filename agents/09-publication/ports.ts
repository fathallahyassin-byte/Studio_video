import { getDb } from "@/lib/db";
import type { Platform, PublishMode, Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import type { Output } from "./schema";
import { readKeywords } from "./settings";

// Accès à la base dont l'agent 9 a besoin pour écrire son plan de publication. Remplacés par des faux dans les tests.

export type PublicationVideo = {
  channelId: string;
  stage: Stage;
  number: number;
  title: string;
  idea: unknown;
  script: unknown;
  /** Video.qaJson : rapport de l'agent 8, source des étiquettes IA */
  qaReport: unknown;
  /** une Validation V3 APPROVED existe pour la vidéo */
  hasV3Approval: boolean;
  /** plateformes de la chaîne ; vide = les trois */
  channelPlatforms: Platform[];
};

/** Un créneau déjà programmé pour une autre vidéo de la chaîne. */
export type TakenSlot = { platform: Platform; scheduledFor: Date; videoNumber: number };

/** Une ligne Publication à créer (ou à mettre à jour tant qu'elle n'est pas partie). */
export type PublicationRow = {
  platform: Platform;
  mode: PublishMode;
  scheduledFor: Date;
  aiLabel: boolean;
  brandedContent: boolean;
};

export type PublicationPorts = {
  now(): Date;
  /** null si la vidéo n'existe pas */
  loadVideo(videoId: string): Promise<PublicationVideo | null>;
  /** liste {{MOTS_CLES}} tenue sur la page de l'agent */
  loadKeywords(): Promise<string>;
  loadTakenSlots(channelId: string, excludeVideoId: string, from: Date): Promise<TakenSlot[]>;
  /** un fournisseur de publication est branché et prêt pour cette plateforme */
  isProviderReady(platform: Platform): boolean;
  /**
   * Dans une transaction : textes dans Video.publishJson et une Publication par plateforme.
   * Une Publication déjà partie (en cours, publiée, en échec) n'est jamais modifiée ; aucun doublon.
   */
  savePlan(videoId: string, texts: Output, rows: readonly PublicationRow[]): Promise<void>;
};

export const PUBLICATION_AGENT_ID = 9;

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaPublicationPorts(): PublicationPorts {
  return {
    now: () => new Date(),
    loadVideo,
    async loadKeywords() {
      const agent = await getDb().agent.findUnique({ where: { id: PUBLICATION_AGENT_ID }, select: { settings: true } });
      return readKeywords(agent?.settings).text;
    },
    async loadTakenSlots(channelId, excludeVideoId, from) {
      const publications = await getDb().publication.findMany({
        where: { status: "SCHEDULED", scheduledFor: { gte: from }, video: { channelId, id: { not: excludeVideoId } } },
        orderBy: { scheduledFor: "asc" },
        take: 30,
        select: { platform: true, scheduledFor: true, video: { select: { number: true } } },
      });
      return publications.flatMap((entry) => (entry.scheduledFor ? [{ platform: entry.platform, scheduledFor: entry.scheduledFor, videoNumber: entry.video.number }] : []));
    },
    // Aucune API de publication n'est branchée (lib/providers/publish.ts) : tout part en mode manuel (NEEDS.md).
    isProviderReady: () => false,
    savePlan,
  };
}

async function loadVideo(videoId: string): Promise<PublicationVideo | null> {
  const video = await getDb().video.findUnique({
    where: { id: videoId },
    select: {
      channelId: true,
      stage: true,
      number: true,
      title: true,
      ideaJson: true,
      scriptJson: true,
      qaJson: true,
      channel: { select: { platforms: true } },
      _count: { select: { validations: { where: { gate: "V3", decision: "APPROVED" } } } },
    },
  });
  if (!video) return null;
  return {
    channelId: video.channelId,
    stage: video.stage,
    number: video.number,
    title: video.title,
    idea: video.ideaJson,
    script: video.scriptJson,
    qaReport: video.qaJson,
    hasV3Approval: video._count.validations > 0,
    channelPlatforms: video.channel.platforms,
  };
}

async function savePlan(videoId: string, texts: Output, rows: readonly PublicationRow[]): Promise<void> {
  const db = getDb();
  await db.$transaction(async (tx) => {
    await tx.video.update({ where: { id: videoId }, data: { publishJson: toInputJson(texts) } });
    // skipDuplicates : (videoId, platform) est unique, une reprise ou un second worker ne crée rien de plus.
    await tx.publication.createMany({ data: rows.map((row) => ({ videoId, ...row, status: "SCHEDULED" as const })), skipDuplicates: true });
    for (const row of rows) {
      await tx.publication.updateMany({ where: { videoId, platform: row.platform, status: "SCHEDULED" }, data: row });
    }
  });
}
