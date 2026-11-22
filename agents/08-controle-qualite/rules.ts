import type { ControlResult } from "@/agents/_shared/types";
import {
  canonicalAgent,
  CHECK_IDS,
  decideFromChecks,
  isBlocking,
  isCheckId,
  missingSourcesFor,
  RESPONSIBLE_AGENTS,
  sourceLabels,
  sourceOwners,
  stricterDecision,
  type Availability,
  type Check,
} from "./checklist";
import type { Output } from "./schema";

// Règles de l'agent 8 appliquées en code : fonctions pures, testées dans rules.test.ts.

/** Ce que le code sait des médias, d'après le storyboard et le plan sonore ; null quand la source manque. */
export type MediaFacts = {
  /** un plan est marqué label_ia_requis (réaliste, pourrait passer pour vrai) */
  realisticAi: boolean | null;
  /** un plan est une image ou une vidéo générée par IA */
  aiVisuals: boolean | null;
  /** la voix off vient de la synthèse vocale */
  aiVoice: boolean | null;
};

/** Contexte des règles : relu en base et dans la bible de l'appel, jamais gardé entre deux étapes. */
export type QaContext = {
  ideaId: string | null;
  hasPartnership: boolean;
  available: Availability;
  media: MediaFacts;
  /** format_video.duree_cible_s de la bible ; null si la bible ne la donne pas */
  durationTarget: { minS: number; maxS: number } | null;
  /** duree_totale_s de la timeline ; null sans timeline */
  timelineDurationS: number | null;
};

export const UNVERIFIED_PREFIX = "NON VÉRIFIÉ :";
export const MAX_SUMMARY_LINES = 5;
/** Arrondis de la timeline tolérés autour de la durée cible. */
export const DURATION_EPSILON_S = 0.5;

type Labels = Output["etiquettes"];
type LabelKey = keyof Labels;

// ---------------------------------------------------------------------------
// normalize : nettoyage, points invérifiables, durée, décision la plus stricte.
// ---------------------------------------------------------------------------

export function normalizeReport(output: Output, qa: QaContext): Output {
  const controles = output.controles.map((check) => checkDuration(forceUnverifiable(cleanCheck(check), qa), qa));
  return {
    ...output,
    idee_id: output.idee_id.trim(),
    controles,
    mentions_a_incruster: cleanMentions(output.mentions_a_incruster),
    resume_pour_humain: output.resume_pour_humain.trim(),
    decision: stricterDecision(output.decision, decideFromChecks(controles)),
  };
}

function cleanCheck(check: Check): Check {
  const correction = check.correction?.trim() || null;
  const responsible = check.agent_responsable?.trim() || null;
  return {
    ...check,
    preuve: check.preuve.trim(),
    correction,
    agent_responsable: responsible === null ? null : (canonicalAgent(responsible) ?? responsible),
  };
}

/** Un point qui dépend d'une source absente ne peut pas être « ok » ni « na » : il devient « ko », non vérifié. */
function forceUnverifiable(check: Check, qa: QaContext): Check {
  if (!isCheckId(check.id)) return check;
  const missing = missingSourcesFor(check.id, qa.available, qa.hasPartnership);
  const [first] = missing;
  if (!first) return check;
  const labels = missing.map((source) => sourceLabels[source]).join(", ");
  const preuve = check.preuve.startsWith(UNVERIFIED_PREFIX) ? check.preuve : `${UNVERIFIED_PREFIX} ${labels} non disponible(s). ${check.preuve}`.trim();
  return {
    ...check,
    statut: "ko",
    preuve,
    correction: check.correction ?? `Produire : ${labels}, puis relancer le contrôle qualité ; ou vérifier ce point à la main avant le GO.`,
    agent_responsable: check.agent_responsable ?? sourceOwners[first],
  };
}

export function isDurationOk(durationS: number, target: { minS: number; maxS: number }): boolean {
  return durationS >= target.minS - DURATION_EPSILON_S && durationS <= target.maxS + DURATION_EPSILON_S;
}

/** E1 : la durée de la timeline se vérifie en code ; hors cible, le point est « ko » quoi qu'en dise le modèle. */
function checkDuration(check: Check, qa: QaContext): Check {
  if (check.id !== "E1" || check.statut === "ko" || qa.timelineDurationS === null || qa.durationTarget === null) return check;
  if (isDurationOk(qa.timelineDurationS, qa.durationTarget)) return check;
  const { minS, maxS } = qa.durationTarget;
  return {
    ...check,
    statut: "ko",
    preuve: `Durée de la timeline : ${qa.timelineDurationS} s, hors de la cible de la bible (${minS} à ${maxS} s). ${check.preuve}`.trim(),
    correction: check.correction ?? `Ramener la durée entre ${minS} et ${maxS} s.`,
    agent_responsable: check.agent_responsable ?? "07-monteur",
  };
}

function cleanMentions(mentions: readonly string[]): string[] {
  const kept: string[] = [];
  for (const mention of mentions.map((value) => value.trim())) {
    if (mention !== "" && !kept.some((existing) => existing.toLowerCase() === mention.toLowerCase())) kept.push(mention);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// controls : refus renvoyés au modèle.
// ---------------------------------------------------------------------------

export function checkReport(output: Output, qa: QaContext): ControlResult[] {
  return [
    checkIds(output.controles),
    checkProofs(output.controles),
    checkFailures(output.controles),
    checkDecisionBacked(output),
    checkIdeaId(output.idee_id, qa.ideaId),
    checkSummary(output.resume_pour_humain),
    checkLabels(output.etiquettes, qa),
    checkMentions(output.mentions_a_incruster, qa),
  ];
}

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });

/** Les 16 points de la check-list, chacun une seule fois. */
export function checkIds(checks: readonly Check[]): ControlResult {
  const ids = checks.map((check) => check.id);
  const unknown = ids.filter((id) => !isCheckId(id));
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missing = CHECK_IDS.filter((id) => !ids.includes(id));
  const problems = [
    unknown.length > 0 ? `points inconnus : ${unknown.join(", ")}` : null,
    duplicated.length > 0 ? `points en double : ${[...new Set(duplicated)].join(", ")}` : null,
    missing.length > 0 ? `points manquants : ${missing.join(", ")}` : null,
  ].filter((problem) => problem !== null);
  if (problems.length === 0) return ok;
  return fail(`La check-list doit contenir exactement les points ${CHECK_IDS.join(", ")} : ${problems.join(" ; ")}.`);
}

/** « Pour chaque point : ok, ko ou na, avec la preuve. » */
export function checkProofs(checks: readonly Check[]): ControlResult {
  const withoutProof = checks.filter((check) => check.preuve.trim() === "").map((check) => check.id);
  return withoutProof.length === 0 ? ok : fail(`Preuve vide pour : ${withoutProof.join(", ")}. Chaque point, ok, ko ou na, se justifie.`);
}

/** Un « ko » dit quoi corriger et à quel agent le renvoyer. */
export function checkFailures(checks: readonly Check[]): ControlResult {
  const problems: string[] = [];
  for (const check of checks.filter((candidate) => candidate.statut === "ko")) {
    if (!check.correction?.trim()) problems.push(`${check.id} : correction manquante`);
    const responsible = check.agent_responsable?.trim() ?? "";
    if (!RESPONSIBLE_AGENTS.includes(responsible)) {
      problems.push(`${check.id} : agent_responsable « ${responsible || "null"} » invalide (attendu : ${RESPONSIBLE_AGENTS.join(", ")})`);
    }
  }
  return problems.length === 0 ? ok : fail(`Points ko incomplets : ${problems.join(" ; ")}.`);
}

/** Un NO_GO ou un GO_AVEC_CORRECTIONS s'appuie sur au moins un point « ko ». */
export function checkDecisionBacked(output: Output): ControlResult {
  if (output.decision === "GO" || output.controles.some((check) => check.statut === "ko")) return ok;
  return fail(`Décision ${output.decision} sans aucun point « ko » : marque le ou les points en cause, ou rends GO.`);
}

export function checkIdeaId(ideeId: string, expected: string | null): ControlResult {
  if (expected === null || ideeId.trim() === expected) return ok;
  return fail(`idee_id « ${ideeId} » ne correspond pas à l'idée de la vidéo (« ${expected} »).`);
}

export function checkSummary(summary: string): ControlResult {
  const lines = summary.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return fail("resume_pour_humain est vide.");
  return lines.length <= MAX_SUMMARY_LINES ? ok : fail(`resume_pour_humain fait ${lines.length} lignes (${MAX_SUMMARY_LINES} au maximum).`);
}

const LABEL_KEYS: readonly LabelKey[] = ["tiktok_contenu_ia", "instagram_contenu_ia", "youtube_utilisation_ia", "contenu_de_marque"];

/** Étiquettes que les médias connus imposent (D1, D3), avec la raison. */
export function requiredLabels(qa: QaContext): Partial<Record<LabelKey, string>> {
  const required: Partial<Record<LabelKey, string>> = {};
  if (qa.media.aiVoice) {
    required.tiktok_contenu_ia = "voix off de synthèse";
    required.instagram_contenu_ia = "voix off de synthèse";
  }
  if (qa.media.realisticAi) {
    const reason = "plan réaliste généré par IA (label_ia_requis dans le storyboard)";
    required.tiktok_contenu_ia = reason;
    required.instagram_contenu_ia = reason;
    required.youtube_utilisation_ia = reason;
  }
  if (qa.hasPartnership) required.contenu_de_marque = "partenariat commercial déclaré";
  return required;
}

export function checkLabels(labels: Labels, qa: QaContext): ControlResult {
  const required = requiredLabels(qa);
  const problems = LABEL_KEYS.filter((key) => required[key] !== undefined && !labels[key]).map((key) => `${key} doit être true (${required[key]})`);
  if (labels.contenu_de_marque && !qa.hasPartnership) problems.push("contenu_de_marque doit être false : la vidéo n'a aucun partenariat");
  return problems.length === 0 ? ok : fail(`Étiquettes incohérentes avec les médias : ${problems.join(" ; ")}.`);
}

type RequiredMention = { text: string; pattern: RegExp; reason: string };

/** Mentions à l'écran que le prompt impose (D2, D3, D4), d'après ce que le code sait. */
export function requiredMentions(qa: QaContext): RequiredMention[] {
  const mentions: RequiredMention[] = [];
  if (qa.media.realisticAi) {
    mentions.push({ text: "Images générées par IA", pattern: /g[ée]n[ée]r[ée]e?s?\s+par\s+(?:l'|l’)?\s*ia\b/i, reason: "D2, plan réaliste généré par IA" });
  }
  if (qa.hasPartnership) {
    mentions.push({ text: "Collaboration commerciale", pattern: /publicit|collaboration commerciale|partenariat|sponsoris/i, reason: "D3, partenariat commercial" });
    if (qa.media.aiVisuals) mentions.push({ text: "Images virtuelles", pattern: /images?\s+virtuelles?/i, reason: "D4, partenariat avec images IA" });
  }
  return mentions;
}

export function checkMentions(mentions: readonly string[], qa: QaContext): ControlResult {
  const missing = requiredMentions(qa).filter((required) => !mentions.some((mention) => required.pattern.test(mention)));
  if (missing.length === 0) return ok;
  return fail(`Mentions à incruster manquantes : ${missing.map((mention) => `« ${mention.text} » (${mention.reason})`).join(" ; ")}.`);
}

// ---------------------------------------------------------------------------
// Après la décision.
// ---------------------------------------------------------------------------

/** Agent à qui renvoyer un NO_GO : celui du premier point bloquant, sinon du premier « ko ». */
export function responsibleAgent(report: Output): string | null {
  const failed = report.controles.filter((check) => check.statut === "ko" && check.agent_responsable);
  const blocking = failed.find((check) => isBlocking(check.id));
  return (blocking ?? failed[0])?.agent_responsable ?? null;
}

/** Raison du blocage affichée à l'humain (file « À valider » et notification). */
export function formatBlockReason(report: Output): string {
  const responsible = responsibleAgent(report) ?? "agent non précisé";
  const failed = report.controles
    .filter((check) => check.statut === "ko")
    .map((check) => `${check.id}${check.correction ? ` : ${check.correction}` : ""}`);
  return `Contrôle qualité : NO-GO, renvoyé à ${responsible}. Points ko : ${failed.join(" | ")}`;
}
