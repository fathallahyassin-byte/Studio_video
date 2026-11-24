import type { AgentId } from "@/agents/_shared/types";
import type { Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";

// Noms reconnus dans la sortie : agents (noms du prompt, slugs ou noms du catalogue) et étapes (enum ou libellé).

/** Destinataire « humain » d'une prochaine action : la seule permise aux validations V1, V2 et V3. */
export const HUMAN = "humain";

/** Pas encore de livrable à contrôler. */
export const NO_DELIVERABLE = "aucun";

/** Noms des agents tels que le prompt les écrit (section ÉQUIPE ET ORDRE DU FLUX). */
export const PROMPT_AGENT_NAMES: Readonly<Record<Exclude<AgentId, 0>, string>> = {
  1: "strategiste_niche",
  2: "veilleur",
  3: "recherchiste",
  4: "scenariste",
  5: "directeur_artistique",
  6: "directeur_son",
  7: "monteur",
  8: "controle_qualite",
  9: "publication",
  10: "analyste",
};

const ALIASES: Readonly<Record<string, Exclude<AgentId, 0>>> = {
  stratege_de_niche: 1,
  strategiste: 1,
  recherchiste_fact_checker: 3,
  voix_son: 6,
  voix_et_son: 6,
};

export type ProposedTarget = { kind: "human" } | { kind: "agent"; agentId: Exclude<AgentId, 0> };

/** « Contrôle qualité », « 08-controle-qualite » → « controle_qualite ». */
export function simplifyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^\d+_/, "");
}

function findAgentId(simple: string): Exclude<AgentId, 0> | null {
  for (const [id, name] of Object.entries(PROMPT_AGENT_NAMES)) {
    if (name === simple) return toWorkerId(Number(id));
  }
  return ALIASES[simple] ?? null;
}

function toWorkerId(value: number): Exclude<AgentId, 0> | null {
  const ids: readonly Exclude<AgentId, 0>[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return ids.find((id) => id === value) ?? null;
}

/** Destinataire reconnu, ou null (l'orchestrateur lui-même n'en est pas un). */
export function parseTarget(value: string): ProposedTarget | null {
  const simple = simplifyName(value);
  if (simple === HUMAN || simple === "humaine") return { kind: "human" };
  const agentId = findAgentId(simple);
  return agentId === null ? null : { kind: "agent", agentId };
}

export function targetName(target: ProposedTarget): string {
  return target.kind === "human" ? HUMAN : PROMPT_AGENT_NAMES[target.agentId];
}

export const ALL_STAGES = Object.keys(stageLabels).filter(isStage);

function isStage(value: string): value is Stage {
  return value in stageLabels;
}

/** « AWAITING_V2 », « awaiting v2 » ou « Attente V2 » → AWAITING_V2 ; null si inconnu. */
export function parseStage(value: string): Stage | null {
  const simple = simplifyName(value);
  return ALL_STAGES.find((stage) => simplifyName(stage) === simple || simplifyName(stageLabels[stage]) === simple) ?? null;
}
