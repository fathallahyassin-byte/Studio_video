import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { Prisma, type BibleAuthor, type PrismaClient } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import { getNotifier } from "@/lib/providers/notify";
import type { StrategyPayload } from "./payload";

// Accès à la base, au modèle de bible et aux notifications. Remplacés par des faux dans les tests.
// La base est ouverte à l'appel, jamais à l'import (le registre est importé partout).

export const AGENT_ID = 1;
export const PAGE_PATH = "/agents/01-strategiste-niche";

export type DraftRef = { id: string; version: number };

export type StoredBibleVersion = { id: string; channelId: string; version: number; content: string; author: BibleAuthor };

/** Ce dont la définition de l'agent a besoin. */
export type StrategyPorts = {
  /** contenu de docs/bible.template.yaml */
  readBibleTemplate(): Promise<string>;
  /** brouillon déjà créé pour cette tâche (reprise après un crash), sinon null */
  findDraftForJob(channelId: string, jobId: string): Promise<DraftRef | null>;
  /** nouvelle BibleVersion (auteur agent 1), jamais active à la création */
  createDraft(input: { channelId: string; content: string; note: string }): Promise<DraftRef>;
  notifyDraft(input: { draft: DraftRef; niche: string }): Promise<void>;
};

/** Ce dont « Adopter cette bible » a besoin : jamais d'écriture dans BibleVersion. */
export type AdoptionPorts = {
  loadBibleVersion(versionId: string): Promise<StoredBibleVersion | null>;
  loadActiveBibleId(channelId: string): Promise<string | null>;
  /** déplace le pointeur Channel.activeBibleVersionId (et la niche affichée) */
  activateBible(input: { channelId: string; versionId: string; niche: string }): Promise<void>;
};

/** Ce dont le lancement depuis la page a besoin. */
export type LaunchPorts = {
  /** une tâche de l'agent 1 est en file ou en cours pour la chaîne */
  hasPendingStrategy(channelId: string): Promise<boolean>;
  /** false si une tâche de même clé existe déjà */
  enqueueStrategy(input: { jobKey: string; channelId: string; payload: StrategyPayload }): Promise<boolean>;
};

export const DRAFT_AUTHOR: BibleAuthor = "AGENT_1";

/** Suffixe de la note du brouillon : retrouve le brouillon d'une tâche sans champ dédié en base. */
export function draftMarker(jobId: string): string {
  return `(tâche ${jobId})`;
}

export async function readBibleTemplateFile(): Promise<string> {
  const template = await readFile(path.join(process.cwd(), "docs", "bible.template.yaml"), "utf8");
  return template.replace(/\r\n/g, "\n");
}

export async function findDraftForJob(db: PrismaClient, channelId: string, jobId: string): Promise<DraftRef | null> {
  return db.bibleVersion.findFirst({
    where: { channelId, author: DRAFT_AUTHOR, note: { endsWith: draftMarker(jobId) } },
    orderBy: { version: "asc" },
    select: { id: true, version: true },
  });
}

/** Numéro suivant et création dans une transaction ; @@unique([channelId, version]) refuse un doublon simultané. */
async function createDraft(db: PrismaClient, input: { channelId: string; content: string; note: string }): Promise<DraftRef> {
  return db.$transaction(async (tx) => {
    const last = await tx.bibleVersion.aggregate({ where: { channelId: input.channelId }, _max: { version: true } });
    return tx.bibleVersion.create({
      data: { channelId: input.channelId, version: (last._max.version ?? 0) + 1, content: input.content, author: DRAFT_AUTHOR, note: input.note },
      select: { id: true, version: true },
    });
  });
}

export function createPrismaStrategyPorts(): StrategyPorts {
  return {
    readBibleTemplate: readBibleTemplateFile,
    findDraftForJob: (channelId, jobId) => findDraftForJob(getDb(), channelId, jobId),
    createDraft: (input) => createDraft(getDb(), input),
    async notifyDraft({ draft, niche }) {
      await getNotifier().notify({
        kind: "validation_waiting",
        title: "Bible proposée : à adopter",
        message: `Le stratège de niche recommande « ${niche} » (brouillon v${draft.version}).`,
        path: PAGE_PATH,
      });
    },
  };
}

export function createPrismaAdoptionPorts(db: PrismaClient = getDb()): AdoptionPorts {
  return {
    loadBibleVersion: (versionId) =>
      db.bibleVersion.findUnique({ where: { id: versionId }, select: { id: true, channelId: true, version: true, content: true, author: true } }),
    async loadActiveBibleId(channelId) {
      const channel = await db.channel.findUnique({ where: { id: channelId }, select: { activeBibleVersionId: true } });
      return channel?.activeBibleVersionId ?? null;
    },
    // Même écriture que « Remettre en service » sur l'écran Bible (voir NEEDS.md : à partager dans lib/bible).
    async activateBible({ channelId, versionId, niche }) {
      await db.channel.update({ where: { id: channelId }, data: { activeBibleVersionId: versionId, niche } });
    },
  };
}

export function createPrismaLaunchPorts(db: PrismaClient = getDb()): LaunchPorts {
  return {
    async hasPendingStrategy(channelId) {
      const pending = await db.agentJob.count({ where: { channelId, agentId: AGENT_ID, status: { in: ["QUEUED", "RUNNING"] } } });
      return pending > 0;
    },
    // Repli en attendant une fonction de lib/pipeline (NEEDS.md) : la ligne AgentJob EST la file.
    async enqueueStrategy({ jobKey, channelId, payload }) {
      try {
        await db.agentJob.create({ data: { jobKey, kind: "AGENT", agentId: AGENT_ID, channelId, payload: toInputJson(payload) } });
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
        throw error;
      }
    },
  };
}
