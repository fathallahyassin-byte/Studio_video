import { agentCatalog } from "@/agents/_shared/catalog";
import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import type { RunStatus, Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { outputSchema, type Output } from "../schema";

// Modèle de vue du panneau, pur (testé sans base) : journal de production, questions des vidéos bloquées,
// dernières propositions de l'orchestrateur.

export const LOG_LIMIT = 50;

export type VideoRef = { number: number; title: string };

export type LogTransition = { id: string; createdAt: Date; video: VideoRef; from: Stage | null; to: Stage; event: string; actor: string };
export type LogRun = { id: string; createdAt: Date; video: VideoRef | null; agentId: number; status: RunStatus; attempt: number };

export type LogEntryView = { key: string; dateIso: string; dateLabel: string; video: string; agent: string; action: string };

const EVENT_LABELS: Record<string, string> = {
  IDEA_PROPOSED: "Idée proposée",
  V1_APPROVED: "V1 validée",
  V1_REJECTED: "V1 : idée écartée",
  RESEARCH_DONE: "Dossier remis",
  SCRIPT_DONE: "Script remis",
  V2_APPROVED: "V2 validée",
  V2_CHANGES_REQUESTED: "V2 : correction demandée",
  MEDIA_DONE: "Visuels et son prêts",
  EDIT_DONE: "Montage terminé",
  RENDER_DONE: "Rendu terminé",
  QA_PASSED: "Contrôle qualité passé",
  V3_APPROVED: "V3 : GO final",
  V3_CHANGES_REQUESTED: "V3 : correction demandée",
  PUBLISHED: "Publiée",
  BLOCKED: "Bloquée",
  RESUMED: "Reprise",
  ABANDONED: "Abandonnée",
};

const RUN_LABELS: Record<RunStatus, string> = {
  OK: "Sortie acceptée",
  INVALID_JSON: "JSON invalide",
  CONTROL_FAILED: "Contrôle refusé",
  ERROR: "Erreur",
};

export function agentName(agentId: number): string {
  return agentCatalog.find((meta) => meta.id === agentId)?.name ?? `Agent ${agentId}`;
}

/** Acteur d'une transition (« agent-4 », « système », adresse de l'humain) → nom affiché. */
export function actorName(actor: string): string {
  const match = /^agent-(\d+)$/.exec(actor);
  if (match) return agentName(Number(match[1]));
  return actor === "système" ? "Système" : "Humain";
}

const videoLabel = (video: VideoRef | null) => (video ? `${formatVideoNumber(video.number)} · ${video.title}` : "—");

function transitionAction(transition: LogTransition): string {
  const event = EVENT_LABELS[transition.event] ?? transition.event;
  const from = transition.from ? `${stageLabels[transition.from]} → ` : "";
  return `${event} (${from}${stageLabels[transition.to]})`;
}

function runAction(run: LogRun): string {
  return `${RUN_LABELS[run.status]} (tentative ${run.attempt}/3)`;
}

type Dated = { at: Date; entry: LogEntryView };

function entry(key: string, at: Date, video: VideoRef | null, agent: string, action: string): Dated {
  return { at, entry: { key, dateIso: at.toISOString(), dateLabel: formatDateTime(at), video: videoLabel(video), agent, action } };
}

/** Les `limit` dernières actions, transitions d'étape et exécutions d'agents mêlées, de la plus récente à la plus ancienne. */
export function buildProductionLog(transitions: readonly LogTransition[], runs: readonly LogRun[], limit = LOG_LIMIT): LogEntryView[] {
  const dated = [
    ...transitions.map((transition) => entry(`t-${transition.id}`, transition.createdAt, transition.video, actorName(transition.actor), transitionAction(transition))),
    ...runs.map((run) => entry(`r-${run.id}`, run.createdAt, run.video, agentName(run.agentId), runAction(run))),
  ];
  return dated
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map((item) => item.entry);
}

/** Sortie enregistrée d'un AgentRun de l'orchestrateur ; null si elle est illisible. */
export function readProposal(output: unknown): Output | null {
  const parsed = outputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Vidéos bloquées : la question posée à l'humain.
// ---------------------------------------------------------------------------

export type BlockedVideoInput = {
  id: string;
  video: VideoRef;
  blockedAt: Stage | null;
  blockedReason: string | null;
  /** entrée en NEEDS_FIX (dernière transition) */
  blockedSince: Date | null;
  /** dernière proposition acceptée de l'orchestrateur pour cette vidéo */
  proposal: { output: unknown; createdAt: Date } | null;
};

export type BlockedVideoView = {
  videoId: string;
  label: string;
  stageLabel: string;
  question: string;
  /** « orchestrateur » : question formulée par l'agent 0 depuis le blocage ; « blocage » : raison du blocage */
  source: "orchestrateur" | "blocage";
};

export const DEFAULT_QUESTION = "La vidéo est bloquée sans raison enregistrée : que doit corriger l'agent avant la reprise ?";

function proposalQuestion(input: BlockedVideoInput): string | null {
  if (!input.proposal) return null;
  if (input.blockedSince && input.proposal.createdAt < input.blockedSince) return null;
  return readProposal(input.proposal.output)?.question_humain ?? null;
}

export function toBlockedVideoView(input: BlockedVideoInput): BlockedVideoView {
  const question = proposalQuestion(input);
  return {
    videoId: input.id,
    label: videoLabel(input.video),
    stageLabel: input.blockedAt ? `Bloquée à l'étape ${stageLabels[input.blockedAt]}` : "Bloquée",
    question: question ?? input.blockedReason?.trim() ?? DEFAULT_QUESTION,
    source: question ? "orchestrateur" : "blocage",
  };
}

// ---------------------------------------------------------------------------
// Dernières propositions.
// ---------------------------------------------------------------------------

export type ProposalRunInput = { id: string; createdAt: Date; video: VideoRef | null; output: unknown };

export type ProposalView = {
  key: string;
  dateLabel: string;
  video: string;
  status: string;
  target: string;
  instruction: string;
  conform: boolean;
  problems: string[];
  journal: string[];
};

const STATUS_LABELS: Record<Output["statut"], string> = {
  en_cours: "En cours",
  attente_validation: "Attente de validation",
  bloque: "Bloquée",
  publie: "Publiée",
};

export function toProposalView(run: ProposalRunInput): ProposalView | null {
  const proposal = readProposal(run.output);
  if (!proposal) return null;
  return {
    key: run.id,
    dateLabel: formatDateTime(run.createdAt),
    video: videoLabel(run.video),
    status: STATUS_LABELS[proposal.statut],
    target: proposal.prochaine_action.agent,
    instruction: proposal.prochaine_action.consigne,
    conform: proposal.controle_dernier_livrable.conforme,
    problems: proposal.controle_dernier_livrable.problemes,
    journal: proposal.journal,
  };
}
