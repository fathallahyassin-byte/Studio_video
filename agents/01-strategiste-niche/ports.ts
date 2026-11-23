import { readFile } from "node:fs/promises";
import path from "node:path";
import { activateBibleVersion } from "@/lib/bible/store";
import { getDb } from "@/lib/db";
import type { BibleAuthor, PrismaClient } from "@/lib/generated/prisma/client";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { requestStrategy } from "@/lib/pipeline/service";
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
  /** nouvelle BibleVersion (auteur agent 1, sourceJobId = la tâche), jamais active à la création */
  createDraft(input: { channelId: string; jobId: string; content: string; note: string }): Promise<DraftRef>;
  notifyDraft(input: { draft: DraftRef; niche: string }): Promise<void>;
};

/** Ce dont « Adopter cette bible » a besoin : jamais d'écriture dans BibleVersion. */
export type AdoptionPorts = {
  loadBibleVersion(versionId: string): Promise<StoredBibleVersion | null>;
  loadActiveBibleId(channelId: string): Promise<string | null>;
  /** déplace le pointeur Channel.activeBibleVersionId (et la niche affichée) */
  activateBible(input: { channelId: string; versionId: string }): Promise<void>;
};

/** Ce dont le lancement depuis la page a besoin. */
export type LaunchPorts = {
  /** une tâche de l'agent 1 est en file ou en cours pour la chaîne */
  hasPendingStrategy(channelId: string): Promise<boolean>;
  /** false si une tâche de même clé existe déjà */
  enqueueStrategy(input: { jobKey: string; channelId: string; payload: StrategyPayload }): Promise<boolean>;
};

export const DRAFT_AUTHOR: BibleAuthor = "AGENT_1";

export async function readBibleTemplateFile(): Promise<string> {
  const template = await readFile(path.join(process.cwd(), "docs", "bible.template.yaml"), "utf8");
  return template.replace(/\r\n/g, "\n");
}

export async function findDraftForJob(db: PrismaClient, channelId: string, jobId: string): Promise<DraftRef | null> {
  return db.bibleVersion.findFirst({
    where: { channelId, sourceJobId: jobId },
    select: { id: true, version: true },
  });
}

/**
 * Numéro suivant et création dans une transaction. Doublon simultané : sourceJobId et (channelId, version)
 * sont uniques, la création échoue et la reprise retrouve le brouillon par findDraftForJob.
 */
async function createDraft(db: PrismaClient, input: { channelId: string; jobId: string; content: string; note: string }): Promise<DraftRef> {
  return db.$transaction(async (tx) => {
    const last = await tx.bibleVersion.aggregate({ where: { channelId: input.channelId }, _max: { version: true } });
    return tx.bibleVersion.create({
      data: { channelId: input.channelId, version: (last._max.version ?? 0) + 1, content: input.content, author: DRAFT_AUTHOR, note: input.note, sourceJobId: input.jobId },
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
    // Même écriture que « Remettre en service » sur l'écran Bible.
    async activateBible(input) {
      await activateBibleVersion(db, input);
    },
  };
}

export function createPrismaLaunchPorts(db: PrismaClient = getDb()): LaunchPorts {
  return {
    async hasPendingStrategy(channelId) {
      const pending = await db.agentJob.count({ where: { channelId, agentId: AGENT_ID, status: { in: ["QUEUED", "RUNNING"] } } });
      return pending > 0;
    },
    async enqueueStrategy(input) {
      const { queued } = await requestStrategy({ ...getPipelineDeps(), db }, input);
      return queued;
    },
  };
}
