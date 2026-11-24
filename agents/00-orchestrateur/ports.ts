import { getDb } from "@/lib/db";
import type { Decision, Gate, RunStatus, Stage } from "@/lib/generated/prisma/client";

// Accès à la base de l'orchestrateur, en LECTURE seule : il propose, la machine à états décide.
// Aucun port ne change l'étape d'une vidéo ni ne rend une décision V1, V2 ou V3. Remplacés par des faux dans les tests.

export const ORCHESTRATOR_ID = 0;

/** Combien d'éléments récents de chaque journal entrent dans {{ETAT_PROJET}}. */
export const RECENT_RUNS = 12;
export const RECENT_TRANSITIONS = 12;
export const RECENT_VALIDATIONS = 10;

export type Deliverables = {
  idee: unknown;
  dossier: unknown;
  script: unknown;
  storyboard: unknown;
  audio: unknown;
  timeline: unknown;
  qa: unknown;
  publication: unknown;
};

export type ProjectRun = { agentId: number; status: RunStatus; attempt: number; error: string | null; cost: number; createdAt: Date };
export type ProjectValidation = { gate: Gate; decision: Decision; note: string | null; decidedBy: string; createdAt: Date };
export type ProjectTransition = { from: Stage | null; to: Stage; event: string; actor: string; note: string | null; createdAt: Date };

/** Tout ce que l'orchestrateur lit d'une vidéo ; listes du plus récent au plus ancien. */
export type ProjectState = {
  id: string;
  number: number;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  blockedReason: string | null;
  partnership: string;
  totalCost: number;
  deliverables: Deliverables;
  runs: ProjectRun[];
  validations: ProjectValidation[];
  transitions: ProjectTransition[];
};

export type OrchestratorPorts = {
  /** null si la vidéo n'existe pas */
  loadProject(videoId: string): Promise<ProjectState | null>;
  /** Agent.active de l'agent 0 (false s'il est absent de la base) */
  isActive(): Promise<boolean>;
  /** BUDGET_PAR_VIDEO tel qu'écrit dans .env */
  readRawBudget(): string | undefined;
  now(): Date;
};

const projectSelect = {
  id: true,
  number: true,
  title: true,
  stage: true,
  blockedAt: true,
  blockedReason: true,
  partnership: true,
  totalCost: true,
  ideaJson: true,
  dossierJson: true,
  scriptJson: true,
  storyboardJson: true,
  audioJson: true,
  timelineJson: true,
  qaJson: true,
  publishJson: true,
  runs: { orderBy: { createdAt: "desc" }, take: RECENT_RUNS, select: { agentId: true, status: true, attempt: true, error: true, cost: true, createdAt: true } },
  validations: { orderBy: { createdAt: "desc" }, take: RECENT_VALIDATIONS, select: { gate: true, decision: true, note: true, decidedBy: true, createdAt: true } },
  transitions: { orderBy: { createdAt: "desc" }, take: RECENT_TRANSITIONS, select: { from: true, to: true, event: true, actor: true, note: true, createdAt: true } },
} as const;

async function loadProject(videoId: string): Promise<ProjectState | null> {
  const video = await getDb().video.findUnique({ where: { id: videoId }, select: projectSelect });
  if (!video) return null;
  return {
    id: video.id,
    number: video.number,
    title: video.title,
    stage: video.stage,
    blockedAt: video.blockedAt,
    blockedReason: video.blockedReason,
    partnership: video.partnership,
    totalCost: video.totalCost.toNumber(),
    deliverables: {
      idee: video.ideaJson,
      dossier: video.dossierJson,
      script: video.scriptJson,
      storyboard: video.storyboardJson,
      audio: video.audioJson,
      timeline: video.timelineJson,
      qa: video.qaJson,
      publication: video.publishJson,
    },
    runs: video.runs.map((run) => ({ ...run, cost: run.cost.toNumber() })),
    validations: video.validations,
    transitions: video.transitions,
  };
}

/** Ports réels : la base est ouverte à l'appel, jamais à l'import (le registre est importé partout). */
export function createPrismaOrchestratorPorts(): OrchestratorPorts {
  return {
    loadProject,
    async isActive() {
      const agent = await getDb().agent.findUnique({ where: { id: ORCHESTRATOR_ID }, select: { active: true } });
      return agent?.active ?? false;
    },
    readRawBudget() {
      return process.env.BUDGET_PAR_VIDEO;
    },
    now() {
      return new Date();
    },
  };
}
