import type { AgentId, ControlResult } from "@/agents/_shared/types";
import type { Stage } from "@/lib/generated/prisma/client";
import { STAGE_AGENTS, stageLabels } from "@/lib/pipeline/machine";
import { HUMAN, NO_DELIVERABLE, parseStage, parseTarget, targetName, type ProposedTarget } from "./names";
import type { Output } from "./schema";

// Contrôles en code de la proposition. L'orchestrateur ne fait aucune transition : ces règles garantissent en plus
// que sa proposition ne peut jamais revenir à rendre une décision V1, V2 ou V3 à la place de l'humain.

/** Étapes où la vidéo attend une validation humaine. */
export const GATE_STAGES: readonly Stage[] = ["AWAITING_V1", "AWAITING_V2", "AWAITING_V3"];

/** Lignes maximum du résumé présenté à l'humain à une validation (prompt, « À CHAQUE TOUR » 5). */
export const MAX_GATE_SUMMARY_LINES = 5;

const HUMAN_TARGET: ProposedTarget = { kind: "human" };

/** Après la publication, seul l'analyste (agent 10) a encore un travail sur la vidéo. */
const AFTER_PIPELINE_AGENTS: Partial<Record<Stage, readonly AgentId[]>> = { PUBLISHED: [10] };

/**
 * Destinataires permis de prochaine_action à chaque étape : l'humain partout ; un agent seulement à l'étape où la
 * machine à états le lance. Aux validations, à la correction (NEEDS_FIX) et hors production : l'humain seul.
 */
export function allowedTargets(stage: Stage): ProposedTarget[] {
  const agents = STAGE_AGENTS[stage] ?? AFTER_PIPELINE_AGENTS[stage] ?? [];
  return [HUMAN_TARGET, ...agents.flatMap((agentId): ProposedTarget[] => (agentId === 0 ? [] : [{ kind: "agent", agentId }]))];
}

/** Statut attendu pour une étape donnée : imposé aux validations, à la correction et à la publication. */
export function allowedStatuses(stage: Stage): Output["statut"][] {
  if (GATE_STAGES.includes(stage)) return ["attente_validation"];
  if (stage === "NEEDS_FIX") return ["bloque"];
  if (stage === "PUBLISHED") return ["publie"];
  return ["en_cours", "bloque"];
}

/** Ce que le code sait de la vidéo au moment du contrôle (relu en base, jamais gardé entre deux appels). */
export type ProposalContext = { videoId: string; stage: Stage; totalCost: number; budget: number | null };

// ---------------------------------------------------------------------------
// Normalisation : noms d'agents et d'étapes ramenés à leur forme canonique, textes nettoyés.
// ---------------------------------------------------------------------------

function canonicalAgent(value: string, allowNone: boolean): string {
  const trimmed = value.trim();
  if (allowNone && trimmed.toLowerCase() === NO_DELIVERABLE) return NO_DELIVERABLE;
  const target = parseTarget(trimmed);
  return target ? targetName(target) : trimmed;
}

export function normalizeProposal(output: Output): Output {
  const question = output.question_humain?.trim() ?? "";
  return {
    ...output,
    video_id: output.video_id.trim(),
    etape_actuelle: parseStage(output.etape_actuelle) ?? output.etape_actuelle.trim(),
    prochaine_action: { ...output.prochaine_action, agent: canonicalAgent(output.prochaine_action.agent, false), consigne: output.prochaine_action.consigne.trim() },
    controle_dernier_livrable: {
      ...output.controle_dernier_livrable,
      agent: canonicalAgent(output.controle_dernier_livrable.agent, true),
      problemes: output.controle_dernier_livrable.problemes.map((problem) => problem.trim()).filter((problem) => problem !== ""),
    },
    question_humain: question === "" ? null : question,
    journal: output.journal.map((line) => line.trim()).filter((line) => line !== ""),
  };
}

// ---------------------------------------------------------------------------
// Garde-fou des validations humaines.
// ---------------------------------------------------------------------------

const GATE_EVENT = /\bV[123]_(APPROVED|REJECTED|CHANGES_REQUESTED)\b/i;
const DECISION_WORD = String.raw`(valid\w*|approuv\w*|approv\w*|accept\w*|GO|feu vert|saute\w*|sauter|ignor\w*)`;
const GATE_NAME = String.raw`(V[123]|validation (humaine|V?[123]))`;
const DECISION_NEAR_GATE = new RegExp(String.raw`\b${DECISION_WORD}\b[^.\n]{0,40}\b${GATE_NAME}\b|\b${GATE_NAME}\b[^.\n]{0,40}\b${DECISION_WORD}\b`, "i");
const DECISION_KEY = /^(decision|d[ée]cision|validation|validations|gate|v[123]|approved|approuve|approuvee|go|go_final)$/i;

/** Vrai si le texte parle de rendre ou de sauter une décision V1, V2 ou V3. */
export function mentionsGateDecision(text: string): boolean {
  return GATE_EVENT.test(text) || DECISION_NEAR_GATE.test(text);
}

function hasDecisionKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDecisionKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) => DECISION_KEY.test(key.trim()) || hasDecisionKey(nested));
}

/**
 * Refus de toute proposition qui reviendrait à décider une validation à la place de l'humain : un agent proposé
 * à une étape qui attend V1, V2 ou V3, ou une consigne (ou des entrées) qui parle de valider, approuver ou sauter
 * une validation.
 */
export function checkNoGateBypass(output: Output, stage: Stage): ControlResult[] {
  const target = parseTarget(output.prochaine_action.agent);
  if (target?.kind === "human") return [{ ok: true }];
  const results: ControlResult[] = [];
  if (GATE_STAGES.includes(stage)) {
    results.push(fail(`La vidéo attend la validation ${stage.slice(-2)} : seul l'humain décide. prochaine_action.agent doit être "${HUMAN}", avec le résumé et la décision attendue dans question_humain.`));
  }
  const entries = JSON.stringify(output.prochaine_action.entrees);
  if (mentionsGateDecision(output.prochaine_action.consigne) || mentionsGateDecision(entries)) {
    results.push(fail("La consigne ou les entrées d'un agent parlent de valider ou de sauter une validation V1, V2 ou V3 : seul l'humain les décide."));
  }
  if (hasDecisionKey(output.prochaine_action.entrees)) {
    results.push(fail("Les entrées d'un agent ne portent jamais de décision de validation (clé « decision », « validation », « V2 »…)."));
  }
  return results.length > 0 ? results : [{ ok: true }];
}

// ---------------------------------------------------------------------------
// Contrôles.
// ---------------------------------------------------------------------------

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });
const check = (condition: boolean, reason: string): ControlResult => (condition ? ok : fail(reason));

const JOURNAL_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} [—–-] \S/;
const PLACEHOLDER = /\b(TODO|TBD|FIXME)\b|à compléter|\[\s*(\.\.\.|…)\s*\]/i;

function checkIdentity(output: Output, context: ProposalContext): ControlResult[] {
  const stage = parseStage(output.etape_actuelle);
  return [
    check(output.video_id === context.videoId, `video_id doit être « ${context.videoId} » (la vidéo de la tâche), pas « ${output.video_id} ».`),
    check(stage === context.stage, `etape_actuelle doit être l'étape réelle en base : « ${context.stage} » (${stageLabels[context.stage]}), pas « ${output.etape_actuelle} ».`),
  ];
}

function checkTarget(output: Output, context: ProposalContext): ControlResult[] {
  const target = parseTarget(output.prochaine_action.agent);
  const allowed = allowedTargets(context.stage).map(targetName);
  if (!target) return [fail(`prochaine_action.agent « ${output.prochaine_action.agent} » n'est pas un agent de l'équipe ; choisis parmi : ${allowed.join(", ")}.`)];
  const name = targetName(target);
  return [check(allowed.includes(name), `À l'étape ${context.stage}, prochaine_action.agent doit être parmi : ${allowed.join(", ")} (pas « ${name} »).`)];
}

function checkStatus(output: Output, context: ProposalContext): ControlResult {
  const allowed = allowedStatuses(context.stage);
  return check(allowed.includes(output.statut), `À l'étape ${context.stage}, statut doit être ${allowed.map((status) => `« ${status} »`).join(" ou ")}.`);
}

function checkQuestion(output: Output, context: ProposalContext): ControlResult[] {
  const target = parseTarget(output.prochaine_action.agent);
  const needsQuestion = target?.kind === "human" || output.statut === "attente_validation" || output.statut === "bloque";
  const lines = output.question_humain?.split("\n").filter((line) => line.trim() !== "").length ?? 0;
  return [
    check(!needsQuestion || output.question_humain !== null, "question_humain est obligatoire quand l'humain doit agir (validation, blocage ou action pour l'humain)."),
    check(!GATE_STAGES.includes(context.stage) || lines <= MAX_GATE_SUMMARY_LINES, `À une validation, question_humain tient en ${MAX_GATE_SUMMARY_LINES} lignes maximum (${lines} lignes).`),
  ];
}

function checkBudget(output: Output, context: ProposalContext): ControlResult {
  const target = parseTarget(output.prochaine_action.agent);
  const reached = context.budget !== null && context.totalCost >= context.budget;
  return check(!reached || target?.kind === "human", `Budget par vidéo atteint (${context.totalCost} sur ${context.budget}) : demande l'accord de l'humain (agent « ${HUMAN} ») avant toute nouvelle étape.`);
}

function checkLastDeliverable(output: Output): ControlResult[] {
  const control = output.controle_dernier_livrable;
  const known = control.agent === NO_DELIVERABLE || parseTarget(control.agent)?.kind === "agent";
  return [
    check(known, `controle_dernier_livrable.agent « ${control.agent} » n'est pas un agent de l'équipe (ou « ${NO_DELIVERABLE} » s'il n'y a pas encore de livrable).`),
    check(control.conforme || control.problemes.length > 0, "Livrable non conforme : liste les corrections précises dans problemes."),
    check(!control.conforme || control.problemes.length === 0, "Livrable conforme mais problemes non vide : choisis."),
  ];
}

function checkTexts(output: Output): ControlResult[] {
  const texts = [output.prochaine_action.consigne, output.question_humain ?? "", ...output.controle_dernier_livrable.problemes];
  return [
    check(output.prochaine_action.consigne !== "", "prochaine_action.consigne est vide."),
    check(!texts.some((text) => PLACEHOLDER.test(text.trim())), "Un champ contient « TODO », « … » ou une valeur à compléter : demande l'information au lieu de l'inventer."),
  ];
}

function checkJournal(output: Output): ControlResult[] {
  const invalid = output.journal.filter((line) => !JOURNAL_LINE.test(line));
  return [
    check(output.journal.length > 0, "journal vide : une ligne datée par action."),
    check(invalid.length === 0, `Lignes du journal au mauvais format (attendu « AAAA-MM-JJ HH:MM — action ») : ${invalid.slice(0, 3).join(" | ")}`),
  ];
}

export function checkProposal(output: Output, context: ProposalContext): ControlResult[] {
  return [
    ...checkIdentity(output, context),
    ...checkTarget(output, context),
    checkStatus(output, context),
    ...checkNoGateBypass(output, context.stage),
    ...checkQuestion(output, context),
    checkBudget(output, context),
    ...checkLastDeliverable(output),
    ...checkTexts(output),
    ...checkJournal(output),
  ];
}
