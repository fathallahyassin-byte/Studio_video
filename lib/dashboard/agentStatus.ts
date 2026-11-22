import type { AgentId } from "@/agents/_shared/types";
import type { Stage } from "@/lib/generated/prisma/client";

export type AgentState = "working" | "waiting" | "idle" | "disabled";

export const agentStateLabels: Record<AgentState, string> = {
  working: "En train de travailler",
  waiting: "Attend une validation",
  idle: "Au repos",
  disabled: "Désactivé",
};

/** Agents qui travaillent sur une vidéo à cette étape. */
const WORKING_AGENTS: Partial<Record<Stage, readonly AgentId[]>> = {
  RESEARCH: [3],
  SCRIPT: [4],
  VISUALS_AND_AUDIO: [5, 6],
  EDIT: [7],
  RENDER: [7],
  QA: [8],
};

/** Agent dont le livrable attend l'humain à cette étape. */
const WAITING_AGENT: Partial<Record<Stage, AgentId>> = {
  AWAITING_V1: 2,
  AWAITING_V2: 4,
  AWAITING_V3: 8,
};

export function deriveAgentState(agent: { id: AgentId; active: boolean }, stagesInProgress: ReadonlySet<Stage>): AgentState {
  if (!agent.active) return "disabled";
  const stages = [...stagesInProgress];
  if (stages.some((stage) => WORKING_AGENTS[stage]?.includes(agent.id))) return "working";
  if (stages.some((stage) => WAITING_AGENT[stage] === agent.id)) return "waiting";
  return "idle";
}
