import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createPrismaOrchestratorPorts, type OrchestratorPorts, type ProjectState } from "./ports";
import { checkProposal, normalizeProposal, type ProposalContext } from "./rules";
import { outputSchema, type Output } from "./schema";
import { formatBudgetVariable, formatProjectState, parseBudget } from "./variables";

// Agent 0 — Orchestrateur : facultatif et désactivé par défaut (CLAUDE.md §5.8). Il lit l'état d'une vidéo, contrôle
// le dernier livrable et PROPOSE la prochaine action. Il ne fait aucune transition : la machine à états décide, et
// une décision V1, V2 ou V3 ne vient que de l'humain (refusée ici en code, et par applyEvent).

const meta = getAgentMeta(0);

export type OrchestratorDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createOrchestratorDefinition(getPorts: () => OrchestratorPorts): OrchestratorDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const ports = getPorts();
      await requireActive(ports);
      const project = await requireProject(ports, input);
      const budget = parseBudget(ports.readRawBudget());
      return {
        ETAT_PROJET: formatProjectState(project, { budget, note: input.note, now: ports.now() }),
        BUDGET_PAR_VIDEO: formatBudgetVariable(budget, project.totalCost),
      };
    },
    normalize(output) {
      return normalizeProposal(output);
    },
    async controls(output, input) {
      return checkProposal(output, await loadContext(getPorts(), input));
    },
    async onSuccess(output, input) {
      await recordProposal(getPorts(), input, output);
    },
  };
}

export function requireVideoId(input: AgentJobInput): string {
  if (!input.videoId) throw new AgentPreconditionError("L'orchestrateur travaille sur une vidéo : la tâche n'a pas de videoId.");
  return input.videoId;
}

/** Désactivé, il n'est jamais appelé : runAgent le refuse déjà, la définition le refuse aussi (avant toute lecture). */
async function requireActive(ports: OrchestratorPorts): Promise<void> {
  if (!(await ports.isActive())) throw new AgentPreconditionError("L'orchestrateur est désactivé : aucun appel.");
}

async function requireProject(ports: OrchestratorPorts, input: AgentJobInput): Promise<ProjectState> {
  const videoId = requireVideoId(input);
  const project = await ports.loadProject(videoId);
  if (!project) throw new AgentPreconditionError(`Vidéo ${videoId} introuvable.`);
  return project;
}

/** Relu à chaque contrôle : aucun état gardé entre buildVariables et controls. */
async function loadContext(ports: OrchestratorPorts, input: AgentJobInput): Promise<ProposalContext> {
  const project = await requireProject(ports, input);
  return { videoId: project.id, stage: project.stage, totalCost: project.totalCost, budget: parseBudget(ports.readRawBudget()) };
}

export type ProposalOutcome = "recorded" | "stale" | "missing";

/**
 * La proposition est déjà enregistrée : runAgent écrit la sortie normalisée dans l'AgentRun avant d'appeler
 * onSuccess, et le panneau la relit (question à l'humain, journal). Ici, rien n'est écrit et aucune étape ne
 * change : la fonction dit seulement si la proposition vaut encore pour l'étape actuelle. Idempotente par
 * construction (les ports de l'orchestrateur sont en lecture seule).
 */
export async function recordProposal(ports: OrchestratorPorts, input: AgentJobInput, output: Output): Promise<ProposalOutcome> {
  const project = await ports.loadProject(requireVideoId(input));
  if (!project) return "missing";
  return project.stage === output.etape_actuelle ? "recorded" : "stale";
}

export const definition: OrchestratorDefinition = createOrchestratorDefinition(createPrismaOrchestratorPorts);
