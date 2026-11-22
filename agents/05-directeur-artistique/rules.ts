import type { ControlResult } from "@/agents/_shared/types";
import type { Output } from "./schema";

// Règles du directeur artistique, en code (fonctions pures) : recalculs et refus renvoyés au modèle.

export type Plan = Output["plans"][number];
export type PlanType = Plan["type"];

/** Écart toléré entre deux bornes (arrondis du modèle), comme pour les beats du scénariste. */
export const TOLERANCE_S = 0.05;
/** Prompt : « Découpe chaque beat en plans de 1,5 à 4 s ». */
export const MIN_PLAN_S = 1.5;
export const MAX_PLAN_S = 4;
/** Prompt : chaque prompt généré contient cette mention. */
export const VERTICAL_MENTION = "vertical 9:16 composition";

/** Types produits par un modèle d'IA : ils ont un prompt, et peuvent être réalistes (label IA). */
export const GENERATED_TYPES: readonly PlanType[] = ["image_ia_animee", "video_ia"];

export function isGenerated(type: PlanType): boolean {
  return GENERATED_TYPES.includes(type);
}

export type ScriptBeatBounds = { n: number; debut_s: number; fin_s: number };

/** Ce que les contrôles comparent au storyboard : le script validé, le budget et les outils branchés. */
export type StoryboardContext = {
  ideaId: string;
  beats: readonly ScriptBeatBounds[];
  /** fin du dernier beat du script */
  scriptEndS: number;
  videoAiBudgetS: number;
  tools: { image: boolean; video: boolean };
  /** identite.style_visuel_en de la bible ; null s'il n'est pas renseigné */
  styleSuffix: string | null;
};

export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function planDuration(plan: Pick<Plan, "debut_s" | "fin_s">): number {
  return plan.fin_s - plan.debut_s;
}

/** Somme des durées des plans video_ia, arrondie au dixième : la seule valeur enregistrée. */
export function computeVideoAiSeconds(plans: readonly Plan[]): number {
  return roundTenth(plans.filter((plan) => plan.type === "video_ia").reduce((total, plan) => total + planDuration(plan), 0));
}

/**
 * Recalculs en code : plans triés dans l'ordre du temps, secondes de vidéo IA recomptées,
 * label IA retiré des plans qui ne sont pas générés (texte animé, séquence réelle).
 */
export function normalizeStoryboard(output: Output): Output {
  const plans = [...output.plans]
    .sort((a, b) => a.debut_s - b.debut_s || a.fin_s - b.fin_s)
    .map((plan) => (isGenerated(plan.type) ? plan : { ...plan, label_ia_requis: false }));
  return { ...output, plans, secondes_video_ia: computeVideoAiSeconds(plans) };
}

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });
const seconds = (value: number) => `${roundTenth(value)} s`;

export function checkStoryboard(output: Output, context: StoryboardContext): ControlResult[] {
  return [
    checkIdeaId(output, context),
    ...checkPlanIds(output.plans),
    ...output.plans.map(checkPlanDuration),
    ...checkCoverage(output.plans, context.scriptEndS),
    ...output.plans.map((plan) => checkPlanInBeat(plan, context.beats)),
    ...output.plans.map((plan) => checkPlanType(plan, context.tools)),
    ...output.plans.map((plan) => checkPlanContent(plan, context.styleSuffix)),
    checkCover(output),
    checkVideoAiBudget(output, context.videoAiBudgetS),
  ];
}

function checkIdeaId(output: Output, context: StoryboardContext): ControlResult {
  return output.idee_id.trim() === context.ideaId.trim() ? ok : fail(`idee_id vaut « ${output.idee_id} » au lieu de « ${context.ideaId} » (celui du script).`);
}

function checkPlanIds(plans: readonly Plan[]): ControlResult[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.id)) duplicates.add(plan.id);
    seen.add(plan.id);
  }
  return [...duplicates].map((id) => fail(`L'id de plan ${id} est utilisé plusieurs fois.`));
}

function checkPlanDuration(plan: Plan): ControlResult {
  const duration = planDuration(plan);
  if (duration <= 0) return fail(`${plan.id} : fin_s (${plan.fin_s}) doit être après debut_s (${plan.debut_s}).`);
  if (duration < MIN_PLAN_S - TOLERANCE_S || duration > MAX_PLAN_S + TOLERANCE_S) {
    return fail(`${plan.id} dure ${seconds(duration)} : un plan dure de ${MIN_PLAN_S} à ${MAX_PLAN_S} s.`);
  }
  return ok;
}

/** Les plans, dans l'ordre du temps, couvrent tout le script : de 0 s à la fin du dernier beat, sans trou ni chevauchement. */
export function checkCoverage(plans: readonly Plan[], scriptEndS: number): ControlResult[] {
  const sorted = [...plans].sort((a, b) => a.debut_s - b.debut_s);
  const results: ControlResult[] = [];
  const first = sorted[0];
  if (first && first.debut_s > TOLERANCE_S) results.push(fail(`Trou au début : le premier plan (${first.id}) commence à ${seconds(first.debut_s)} au lieu de 0 s.`));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current) results.push(checkJunction(previous, current));
  }
  for (const plan of sorted) {
    if (plan.fin_s > scriptEndS + TOLERANCE_S) results.push(fail(`${plan.id} finit à ${seconds(plan.fin_s)}, après la fin du script (${seconds(scriptEndS)}).`));
  }
  const last = sorted.at(-1);
  if (last && last.fin_s < scriptEndS - TOLERANCE_S) {
    results.push(fail(`Trou à la fin : le dernier plan (${last.id}) finit à ${seconds(last.fin_s)}, le script dure ${seconds(scriptEndS)}.`));
  }
  return results;
}

function checkJunction(previous: Plan, current: Plan): ControlResult {
  const gap = current.debut_s - previous.fin_s;
  if (gap > TOLERANCE_S) return fail(`Trou de ${seconds(gap)} entre ${previous.id} (fin ${seconds(previous.fin_s)}) et ${current.id} (début ${seconds(current.debut_s)}).`);
  if (gap < -TOLERANCE_S) return fail(`${current.id} chevauche ${previous.id} : il commence à ${seconds(current.debut_s)}, avant la fin de ${previous.id} (${seconds(previous.fin_s)}).`);
  return ok;
}

function checkPlanInBeat(plan: Plan, beats: readonly ScriptBeatBounds[]): ControlResult {
  const beat = beats.find((entry) => entry.n === plan.beat);
  if (!beat) return fail(`${plan.id} renvoie au beat ${plan.beat}, absent du script.`);
  if (plan.debut_s < beat.debut_s - TOLERANCE_S || plan.fin_s > beat.fin_s + TOLERANCE_S) {
    return fail(`${plan.id} (${seconds(plan.debut_s)} à ${seconds(plan.fin_s)}) sort du beat ${beat.n} (${seconds(beat.debut_s)} à ${seconds(beat.fin_s)}).`);
  }
  return ok;
}

function checkPlanType(plan: Plan, tools: StoryboardContext["tools"]): ControlResult {
  if (plan.type === "image_ia_animee" && !tools.image) return fail(`${plan.id} est de type image_ia_animee, mais aucun modèle image IA n'est disponible.`);
  if (plan.type === "video_ia" && !tools.video) return fail(`${plan.id} est de type video_ia, mais aucun modèle vidéo IA n'est disponible.`);
  return ok;
}

function checkPlanContent(plan: Plan, styleSuffix: string | null): ControlResult {
  const problems = isGenerated(plan.type) ? generatedPromptProblems(plan, styleSuffix) : otherTypeProblems(plan);
  return problems.length === 0 ? ok : fail(`${plan.id} (${plan.type}) : ${problems.join(" ; ")}.`);
}

function generatedPromptProblems(plan: Plan, styleSuffix: string | null): string[] {
  const prompt = plan.prompt_en?.trim() ?? "";
  if (prompt === "") return ["prompt_en manquant"];
  const problems: string[] = [];
  if (!includesLoosely(prompt, VERTICAL_MENTION)) problems.push(`prompt_en sans « ${VERTICAL_MENTION} »`);
  if (styleSuffix && !includesLoosely(prompt, styleSuffix)) problems.push(`prompt_en sans le suffixe de style de la bible (« ${styleSuffix} »)`);
  if ((plan.negative_prompt_en?.trim() ?? "") === "") problems.push("negative_prompt_en manquant");
  return problems;
}

function otherTypeProblems(plan: Plan): string[] {
  if (plan.type === "stock" && plan.mots_cles_stock.every((keyword) => keyword.trim() === "")) return ["mots_cles_stock vide"];
  if (plan.type === "texte_anime" && plan.texte_ecran.trim() === "") return ["texte_ecran vide pour un texte animé"];
  return [];
}

/** Comparaison sans casse, espaces multiples ni point final : le modèle reformate souvent le suffixe. */
function includesLoosely(text: string, fragment: string): boolean {
  const simplify = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  return simplify(text).includes(simplify(fragment));
}

function checkCover(output: Output): ControlResult {
  return output.plans.some((plan) => plan.id === output.couverture.plan) ? ok : fail(`couverture.plan (${output.couverture.plan}) ne correspond à aucun plan.`);
}

/** Refus renvoyé au modèle : au 3ᵉ échec, runAgent met la vidéo en NEEDS_FIX et alerte (aucune génération n'a eu lieu). */
export function checkVideoAiBudget(output: Output, budgetS: number): ControlResult {
  const total = computeVideoAiSeconds(output.plans);
  if (total <= budgetS + TOLERANCE_S) return ok;
  const ids = output.plans.filter((plan) => plan.type === "video_ia").map((plan) => plan.id);
  return fail(
    `Vidéo IA : ${seconds(total)} pour un budget de ${seconds(budgetS)} (plans ${ids.join(", ")}). Remplace des plans video_ia par image_ia_animee, stock ou texte_anime.`,
  );
}
