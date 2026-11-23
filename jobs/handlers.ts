import { getAgentMeta, parseAgentId } from "@/agents/_shared/catalog";
import { AgentNotImplementedError } from "@/agents/_shared/placeholder";
import type { AgentId, AgentJobInput, AnyAgentDefinition } from "@/agents/_shared/types";
import { agentRegistry } from "@/agents/registry";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createPrismaRunStore } from "@/lib/agents/prismaStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { AgentJob, PrismaClient } from "@/lib/generated/prisma/client";
import { backoffMs, completeJob, failJob, MAX_JOB_ATTEMPTS, retryJob } from "@/lib/queue/queue";
import type { LlmProvider } from "@/lib/providers/llm";
import type { Notifier } from "@/lib/providers/notify";
import type { RenderProvider } from "@/lib/providers/render";
import type { JobOutcome } from "./outcome";
import { createPrismaRenderPorts, runRenderJob } from "./render";

// Exécution d'une tâche de la file. Le résultat dit au worker quoi faire de la tâche.

export type { JobOutcome } from "./outcome";

export type JobDeps = {
  db: PrismaClient;
  notifier: Notifier;
  /** null tant qu'aucun fournisseur LLM n'est choisi */
  llm: LlmProvider | null;
  /** par défaut le registre des agents ; remplaçable dans les tests */
  definitionFor?: (agentId: AgentId) => AnyAgentDefinition;
  /** rendu Remotion ; null ou absent tant que le stockage n'est pas configuré */
  renderer?: RenderProvider | null;
};

const HOUR = 60 * 60 * 1000;

export async function handleJob(job: AgentJob, deps: JobDeps): Promise<JobOutcome> {
  if (job.kind === "RENDER") return runRenderJob(job, createPrismaRenderPorts(deps), deps.renderer ?? null);
  if (job.agentId === null) return { kind: "failed", reason: "Tâche d'agent sans agentId." };

  if (job.videoId) {
    const video = await deps.db.video.findUnique({ where: { id: job.videoId }, select: { stage: true } });
    if (!video) return { kind: "failed", reason: "Vidéo introuvable." };
    if (job.stage !== null && video.stage !== job.stage) return { kind: "done", note: "Ignorée : la vidéo a changé d'étape." };
  }
  if (!deps.llm) return { kind: "retry", delayMs: HOUR, reason: "Aucun fournisseur LLM configuré." };
  return runAgentJob(job, parseAgentId(job.agentId), { ...deps, llm: deps.llm });
}

async function runAgentJob(job: AgentJob, agentId: AgentId, deps: JobDeps & { llm: LlmProvider }): Promise<JobOutcome> {
  const definition: AnyAgentDefinition = deps.definitionFor ? deps.definitionFor(agentId) : agentRegistry[agentId];
  const input: AgentJobInput = { jobId: job.id, channelId: job.channelId, videoId: job.videoId, note: job.note, payload: job.payload };
  try {
    const result = await runAgent(
      { definition, input, channelId: job.channelId, videoId: job.videoId, jobKey: job.jobKey },
      { store: createPrismaRunStore(deps.db), llm: deps.llm, notifier: deps.notifier },
    );
    // needs_fix : runAgent a déjà bloqué la vidéo et prévenu l'humain.
    return result.status === "ok" ? { kind: "done" } : { kind: "done", note: `3 échecs : ${result.reason}` };
  } catch (error) {
    return classifyError(error, job);
  }
}

function classifyError(error: unknown, job: AgentJob): JobOutcome {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof AgentNotImplementedError) return { kind: "retry", delayMs: 6 * HOUR, reason };
  // Configuration à corriger par l'humain (modèle, bible, variable) : on prévient à la première prise seulement.
  if (error instanceof AgentPreconditionError) return { kind: "retry", delayMs: HOUR, reason, alert: job.attempts <= 1 };
  if (job.attempts >= MAX_JOB_ATTEMPTS) return { kind: "failed", reason };
  return { kind: "retry", delayMs: backoffMs(job.attempts), reason };
}

/** Enregistre le résultat de la tâche et alerte l'humain quand il doit agir. */
export async function applyOutcome(job: AgentJob, outcome: JobOutcome, deps: Pick<JobDeps, "db" | "notifier">): Promise<void> {
  const agentName = job.agentId === null ? "Rendu" : getAgentMeta(parseAgentId(job.agentId)).name;
  const path = job.videoId ? `/validations?item=${job.videoId}` : job.agentId === null ? "/production" : `/agents/${getAgentMeta(parseAgentId(job.agentId)).slug}`;
  switch (outcome.kind) {
    case "done":
      await completeJob(deps.db, job.id, outcome.note);
      return;
    case "retry":
      await retryJob(deps.db, job.id, outcome.reason, outcome.delayMs);
      if (outcome.alert) await deps.notifier.notify({ kind: "agent_failed", title: `${agentName} ne peut pas démarrer`, message: outcome.reason, path });
      return;
    case "failed":
      await failJob(deps.db, job.id, outcome.reason);
      await deps.notifier.notify({ kind: "agent_failed", title: `Tâche abandonnée : ${agentName}`, message: outcome.reason, path });
      return;
  }
}

/** Prend une tâche due et la traite. Renvoie false s'il n'y avait rien à faire. */
export async function processNextJob(deps: JobDeps, claim: (db: PrismaClient) => Promise<AgentJob | null>): Promise<boolean> {
  const job = await claim(deps.db);
  if (!job) return false;
  let outcome: JobOutcome;
  try {
    outcome = await handleJob(job, deps);
  } catch (error) {
    outcome = classifyError(error, job);
  }
  await applyOutcome(job, outcome, deps);
  return true;
}
