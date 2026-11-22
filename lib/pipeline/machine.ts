import type { AgentId } from "@/agents/_shared/types";
import type { Stage } from "@/lib/generated/prisma/client";

// Machine à états des vidéos (CLAUDE.md §4) : règles pures, sans base. Le service (service.ts) les applique.

export type PipelineEvent =
  | "IDEA_PROPOSED"
  | "V1_APPROVED"
  | "V1_REJECTED"
  | "RESEARCH_DONE"
  | "SCRIPT_DONE"
  | "V2_APPROVED"
  | "V2_CHANGES_REQUESTED"
  | "MEDIA_DONE"
  | "EDIT_DONE"
  | "RENDER_DONE"
  | "QA_PASSED"
  | "V3_APPROVED"
  | "V3_CHANGES_REQUESTED"
  | "PUBLISHED"
  | "BLOCKED"
  | "RESUMED"
  | "ABANDONED";

/** Étapes où un agent (ou le rendu) travaille : on peut y bloquer une vidéo. */
export const WORKING_STAGES: readonly Stage[] = ["RESEARCH", "SCRIPT", "VISUALS_AND_AUDIO", "EDIT", "RENDER", "QA", "SCHEDULED"];

/** Étapes où renvoyer une vidéo après « Demander une correction » en V3. */
export const V3_RETURN_STAGES = ["SCRIPT", "VISUALS_AND_AUDIO", "EDIT", "QA"] as const satisfies readonly Stage[];
export type V3ReturnStage = (typeof V3_RETURN_STAGES)[number];

const SIMPLE: Partial<Record<PipelineEvent, { from: Stage; to: Stage }>> = {
  IDEA_PROPOSED: { from: "IDEA", to: "AWAITING_V1" },
  V1_APPROVED: { from: "AWAITING_V1", to: "RESEARCH" },
  V1_REJECTED: { from: "AWAITING_V1", to: "REJECTED" },
  RESEARCH_DONE: { from: "RESEARCH", to: "SCRIPT" },
  SCRIPT_DONE: { from: "SCRIPT", to: "AWAITING_V2" },
  V2_APPROVED: { from: "AWAITING_V2", to: "VISUALS_AND_AUDIO" },
  V2_CHANGES_REQUESTED: { from: "AWAITING_V2", to: "SCRIPT" },
  MEDIA_DONE: { from: "VISUALS_AND_AUDIO", to: "EDIT" },
  EDIT_DONE: { from: "EDIT", to: "RENDER" },
  RENDER_DONE: { from: "RENDER", to: "QA" },
  QA_PASSED: { from: "QA", to: "AWAITING_V3" },
  V3_APPROVED: { from: "AWAITING_V3", to: "SCHEDULED" },
  PUBLISHED: { from: "SCHEDULED", to: "PUBLISHED" },
};

export type TransitionInput = {
  stage: Stage;
  blockedAt: Stage | null;
  event: PipelineEvent;
  /** V3_CHANGES_REQUESTED : étape où renvoyer la vidéo */
  returnTo?: V3ReturnStage;
  /** PUBLISHED : une Validation V3 approuvée existe */
  hasV3Approval?: boolean;
};

export type TransitionResult =
  | { ok: true; from: Stage; to: Stage; blockedAt: Stage | null }
  | { ok: false; reason: string };

const refuse = (reason: string): TransitionResult => ({ ok: false, reason });

export function transition(input: TransitionInput): TransitionResult {
  const { stage, event } = input;
  switch (event) {
    case "BLOCKED":
      return WORKING_STAGES.includes(stage)
        ? { ok: true, from: stage, to: "NEEDS_FIX", blockedAt: stage }
        : refuse(`Impossible de bloquer une vidéo à l'étape ${stage}.`);
    case "RESUMED":
      if (stage !== "NEEDS_FIX" || input.blockedAt === null) return refuse("La vidéo n'est pas en attente de correction.");
      return { ok: true, from: stage, to: input.blockedAt, blockedAt: null };
    case "ABANDONED":
      return stage === "PUBLISHED" || stage === "REJECTED"
        ? refuse("Une vidéo publiée ou déjà écartée ne s'abandonne pas.")
        : { ok: true, from: stage, to: "REJECTED", blockedAt: null };
    case "V3_CHANGES_REQUESTED":
      if (stage !== "AWAITING_V3") return refuse("La vidéo n'attend pas de validation V3.");
      return { ok: true, from: stage, to: input.returnTo ?? "EDIT", blockedAt: null };
    case "PUBLISHED":
      if (!input.hasV3Approval) return refuse("Publication refusée : aucune validation V3 approuvée.");
      break;
    default:
      break;
  }
  const rule = SIMPLE[event];
  if (!rule) return refuse(`Événement inconnu : ${event}`);
  if (rule.from !== stage) return refuse(`L'événement ${event} n'est pas possible à l'étape ${stage} (attendu : ${rule.from}).`);
  return { ok: true, from: stage, to: rule.to, blockedAt: null };
}

/** Agents à lancer quand une vidéo entre dans une étape. Les agents 5 et 6 tournent en parallèle. */
export const STAGE_AGENTS: Partial<Record<Stage, readonly AgentId[]>> = {
  RESEARCH: [3],
  SCRIPT: [4],
  VISUALS_AND_AUDIO: [5, 6],
  EDIT: [7],
  QA: [8],
  SCHEDULED: [9],
};

/** Étapes sans agent mais avec une tâche (le rendu Remotion). */
export const STAGE_RENDER: readonly Stage[] = ["RENDER"];

/** Étapes qui attendent l'humain : une notification part quand une vidéo y entre. */
export const HUMAN_STAGES: readonly Stage[] = ["AWAITING_V1", "AWAITING_V2", "AWAITING_V3", "NEEDS_FIX"];

export const stageLabels: Record<Stage, string> = {
  IDEA: "Idée",
  AWAITING_V1: "Attente V1",
  RESEARCH: "Recherche",
  SCRIPT: "Script",
  AWAITING_V2: "Attente V2",
  VISUALS_AND_AUDIO: "Visuels et son",
  EDIT: "Montage",
  RENDER: "Rendu",
  QA: "Contrôle qualité",
  AWAITING_V3: "Attente V3",
  SCHEDULED: "Programmée",
  PUBLISHED: "Publiée",
  REJECTED: "Écartée",
  NEEDS_FIX: "À corriger",
};
