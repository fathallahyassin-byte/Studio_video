import type { Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { HUMAN, NO_DELIVERABLE, PROMPT_AGENT_NAMES } from "./names";
import type { Deliverables, ProjectRun, ProjectState } from "./ports";
import { allowedTargets, GATE_STAGES } from "./rules";

// Texte des {{VARIABLES}} du prompt. Ce qui manque est dit en clair : le modèle n'invente ni budget ni livrable.

/** Taille maximale d'un livrable recopié dans {{ETAT_PROJET}} (le reste est tronqué, et dit). */
export const DELIVERABLE_MAX_CHARS = 4000;

export const NOTE_HEADING = "NOTE DE L'HUMAIN (prioritaire)";

export const BUDGET_MISSING =
  "non configuré (BUDGET_PAR_VIDEO absent ou invalide dans .env) : toute génération payante sera refusée par les agents 5 et 6 ; propose à l'humain de le renseigner.";

/** BUDGET_PAR_VIDEO lisible (nombre > 0), sinon null. */
export function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * {{BUDGET_PAR_VIDEO}} : sans budget lisible, un texte explicite plutôt qu'une précondition. L'orchestrateur ne
 * dépense rien lui-même ; les agents payants (5 et 6) refusent déjà toute génération sans budget.
 */
export function formatBudgetVariable(budget: number | null, totalCost: number): string {
  if (budget === null) return BUDGET_MISSING;
  const remaining = round2(budget - totalCost);
  const status = remaining <= 0 ? "budget ATTEINT : toute prochaine action payante attend l'accord de l'humain" : `reste ${remaining}`;
  return `${budget} par vidéo (déjà dépensé : ${round2(totalCost)} ; ${status})`;
}

/** Un livrable recopié tel quel, tronqué au-delà de `max` caractères ; null s'il n'existe pas encore. */
export function summarizeDeliverable(value: unknown, max = DELIVERABLE_MAX_CHARS): string | null {
  if (value === null || value === undefined) return null;
  const json = JSON.stringify(value);
  return json.length <= max ? json : `${json.slice(0, max)}… (tronqué : ${json.length} caractères au total)`;
}

function summarizeDeliverables(deliverables: Deliverables): Record<string, string | null> {
  return Object.fromEntries(Object.entries(deliverables).map(([key, value]) => [key, summarizeDeliverable(value)]));
}

export function agentLabel(agentId: number): string {
  if (agentId === 0) return "orchestrateur";
  const known = Object.entries(PROMPT_AGENT_NAMES).find(([id]) => Number(id) === agentId);
  return known ? known[1] : `agent-${agentId}`;
}

/** « agent-4 » (journal des transitions) → « scenariste » ; « système » et l'humain restent lisibles. */
export function actorLabel(actor: string): string {
  const match = /^agent-(\d+)$/.exec(actor);
  if (match) return agentLabel(Number(match[1]));
  return actor === "système" ? actor : HUMAN;
}

/** Dernier livrable accepté d'un autre agent que l'orchestrateur : celui à contrôler. */
export function lastDeliverableAgent(runs: readonly ProjectRun[]): string {
  const last = runs.find((run) => run.status === "OK" && run.agentId !== 0);
  return last ? agentLabel(last.agentId) : NO_DELIVERABLE;
}

function formatRuns(runs: readonly ProjectRun[]) {
  return runs.map((run) => ({
    date: run.createdAt.toISOString(),
    agent: agentLabel(run.agentId),
    statut: run.status,
    tentative: run.attempt,
    erreur: run.error,
    cout: round2(run.cost),
  }));
}

function expectedNext(stage: Stage): string {
  const names = allowedTargets(stage).map((target) => (target.kind === "human" ? HUMAN : PROMPT_AGENT_NAMES[target.agentId]));
  const gate = GATE_STAGES.includes(stage) ? ` Validation humaine en attente : statut "attente_validation", agent "${HUMAN}", question_humain = résumé de 5 lignes maximum et décision attendue.` : "";
  return `prochaine_action.agent parmi : ${names.join(", ")}.${gate} La consigne et les entrées d'un agent ne parlent jamais de valider, approuver ou sauter V1, V2 ou V3 : refusé en code.`;
}

/** {{ETAT_PROJET}} : la vidéo, ses livrables, ses exécutions, ses validations, son journal et son coût. */
export function formatProjectState(project: ProjectState, options: { budget: number | null; note: string | null; now: Date }): string {
  const state = {
    maintenant: options.now.toISOString(),
    video: {
      video_id: project.id,
      numero: `V-${String(project.number).padStart(3, "0")}`,
      titre: project.title,
      etape_actuelle: project.stage,
      etape_libelle: stageLabels[project.stage],
      bloquee_a: project.blockedAt,
      raison_blocage: project.blockedReason,
      partenariat: project.partnership,
      cout_total: round2(project.totalCost),
      budget_restant: options.budget === null ? null : round2(options.budget - project.totalCost),
    },
    regles_de_cette_etape: expectedNext(project.stage),
    dernier_livrable_a_controler: lastDeliverableAgent(project.runs),
    livrables: summarizeDeliverables(project.deliverables),
    executions_recentes: formatRuns(project.runs),
    // L'adresse de l'humain (decidedBy) ne part pas au fournisseur LLM : « humain » suffit.
    validations: project.validations.map((validation) => ({
      date: validation.createdAt.toISOString(),
      validation: validation.gate,
      decision: validation.decision,
      note: validation.note,
      par: actorLabel(validation.decidedBy),
    })),
    journal_des_etapes: project.transitions.map((transition) => ({
      date: transition.createdAt.toISOString(),
      de: transition.from,
      vers: transition.to,
      evenement: transition.event,
      par: actorLabel(transition.actor),
      note: transition.note,
    })),
  };
  const json = JSON.stringify(state, null, 2);
  const note = options.note?.trim();
  return note ? `${json}\n\n${NOTE_HEADING} :\n${note}` : json;
}
