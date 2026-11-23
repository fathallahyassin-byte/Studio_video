import type { BibleAuthor } from "@/lib/generated/prisma/client";
import { BIBLE_TEMPLATE } from "./fixtures";
import type { AdoptionPorts, DraftRef, LaunchPorts, StoredBibleVersion, StrategyPorts } from "./ports";
import type { StrategyPayload } from "./payload";

// Faux ports en mémoire (tests uniquement) : une chaîne, ses BibleVersion immuables et la file.

export type FakeWorld = {
  versions: StoredBibleVersion[];
  notes: Map<string, string>;
  /** id de version → id de la tâche qui l'a produite (BibleVersion.sourceJobId) */
  sourceJobs: Map<string, string>;
  activeBibleId: string | null;
  jobs: { jobKey: string; channelId: string; payload: StrategyPayload; status: "QUEUED" | "RUNNING" | "DONE" }[];
  notified: { draft: DraftRef; niche: string }[];
  writes: { activate: number; create: number };
};

export function createWorld(initial: { content: string; author: BibleAuthor; active?: boolean }[] = []): FakeWorld {
  const world: FakeWorld = { versions: [], notes: new Map(), sourceJobs: new Map(), activeBibleId: null, jobs: [], notified: [], writes: { activate: 0, create: 0 } };
  initial.forEach((entry, index) => {
    const id = `bible-${index + 1}`;
    world.versions.push(Object.freeze({ id, channelId: "chaine-1", version: index + 1, content: entry.content, author: entry.author }));
    if (entry.active) world.activeBibleId = id;
  });
  return world;
}

/** Copie profonde de l'état des versions, pour vérifier qu'aucune n'a changé. */
export function snapshotVersions(world: FakeWorld): string {
  return JSON.stringify(world.versions);
}

export function fakeStrategyPorts(world: FakeWorld, template = BIBLE_TEMPLATE): StrategyPorts {
  return {
    async readBibleTemplate() {
      return template;
    },
    async findDraftForJob(channelId, jobId) {
      const found = world.versions.find((version) => version.channelId === channelId && world.sourceJobs.get(version.id) === jobId);
      return found ? { id: found.id, version: found.version } : null;
    },
    async createDraft({ channelId, jobId, content, note }) {
      if ([...world.sourceJobs.values()].includes(jobId)) throw new Error("sourceJobId déjà pris (contrainte unique)");
      world.writes.create += 1;
      const version = Math.max(0, ...world.versions.filter((entry) => entry.channelId === channelId).map((entry) => entry.version)) + 1;
      const id = `bible-${world.versions.length + 1}`;
      world.versions.push(Object.freeze({ id, channelId, version, content, author: "AGENT_1" }));
      world.notes.set(id, note);
      world.sourceJobs.set(id, jobId);
      return { id, version };
    },
    async notifyDraft(input) {
      world.notified.push(input);
    },
  };
}

export function fakeAdoptionPorts(world: FakeWorld): AdoptionPorts {
  return {
    async loadBibleVersion(versionId) {
      return world.versions.find((version) => version.id === versionId) ?? null;
    },
    async loadActiveBibleId() {
      return world.activeBibleId;
    },
    async activateBible({ versionId }) {
      world.writes.activate += 1;
      world.activeBibleId = versionId;
    },
  };
}

export function fakeLaunchPorts(world: FakeWorld): LaunchPorts {
  return {
    async hasPendingStrategy(channelId) {
      return world.jobs.some((job) => job.channelId === channelId && (job.status === "QUEUED" || job.status === "RUNNING"));
    },
    async enqueueStrategy({ jobKey, channelId, payload }) {
      if (world.jobs.some((job) => job.jobKey === jobKey)) return false;
      world.jobs.push({ jobKey, channelId, payload, status: "QUEUED" });
      return true;
    },
  };
}
