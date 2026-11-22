import { agentCatalog } from "@/agents/_shared/catalog";
import type { Output } from "./schema";

// La check-list du prompt (A1 à F1), la règle de décision et les sources dont chaque point a besoin.
// Fonctions pures : partagées par les règles, les variables et le panneau.

export type Check = Output["controles"][number];
export type Decision = Output["decision"];
export type CheckGroup = "A" | "B" | "C" | "D" | "E" | "F";

export const CHECK_IDS = ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "D3", "D4", "D5", "E1", "E2", "E3", "E4", "F1"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const groupLabels: Record<CheckGroup, string> = {
  A: "Faits",
  B: "Originalité",
  C: "Droits",
  D: "Transparence",
  E: "Technique",
  F: "Bible",
};

export const CHECK_GROUPS: readonly CheckGroup[] = ["A", "B", "C", "D", "E", "F"];

/** Un « ko » sur ces groupes donne un NO_GO (prompt, section DÉCISION). */
const BLOCKING_GROUPS: readonly CheckGroup[] = ["A", "C", "D"];

export function isCheckId(id: string): id is CheckId {
  return CHECK_IDS.some((known) => known === id);
}

export function groupOf(id: string): CheckGroup | null {
  const letter = id.charAt(0);
  return CHECK_GROUPS.find((group) => group === letter) ?? null;
}

// ---------------------------------------------------------------------------
// Décision recalculée en code.
// ---------------------------------------------------------------------------

const STRICTNESS: Record<Decision, number> = { GO: 0, GO_AVEC_CORRECTIONS: 1, NO_GO: 2 };

/** NO_GO si un point A, C ou D est ko ; GO_AVEC_CORRECTIONS si seuls des points B, E ou F sont ko ; GO sinon. */
export function decideFromChecks(checks: readonly Check[]): Decision {
  const failed = checks.filter((check) => check.statut === "ko");
  if (failed.some((check) => isBlocking(check.id))) return "NO_GO";
  return failed.length > 0 ? "GO_AVEC_CORRECTIONS" : "GO";
}

export function isBlocking(id: string): boolean {
  const group = groupOf(id);
  return group !== null && BLOCKING_GROUPS.includes(group);
}

/** En cas de désaccord, la décision la plus stricte l'emporte. */
export function stricterDecision(a: Decision, b: Decision): Decision {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

export function isGo(decision: Decision): boolean {
  return decision !== "NO_GO";
}

// ---------------------------------------------------------------------------
// Sources : ce qu'il faut avoir sous les yeux pour pouvoir dire « ok ».
// ---------------------------------------------------------------------------

/** Entrées qui peuvent manquer (le dossier et le script sont des préconditions). */
export type SourceKey = "STORYBOARD" | "PLAN_SONORE" | "TIMELINE" | "TRANSCRIPTION" | "CAPTURES";

export const sourceLabels: Record<SourceKey, string> = {
  STORYBOARD: "storyboard (agent 5)",
  PLAN_SONORE: "plan sonore (agent 6)",
  TIMELINE: "timeline (agent 7)",
  TRANSCRIPTION: "transcription Whisper du rendu",
  CAPTURES: "captures des images clés du rendu",
};

/** Agent à qui renvoyer un point non vérifiable faute de cette source. */
export const sourceOwners: Record<SourceKey, string> = {
  STORYBOARD: "05-directeur-artistique",
  PLAN_SONORE: "06-voix-son",
  TIMELINE: "07-monteur",
  // Pas encore produites par le pipeline (voir NEEDS.md) : le contrôle est à relancer une fois branchées.
  TRANSCRIPTION: "08-controle-qualite",
  CAPTURES: "08-controle-qualite",
};

/** Sources indispensables pour vérifier chaque point de la check-list. */
export const CHECK_SOURCES: Record<CheckId, readonly SourceKey[]> = {
  A1: ["TRANSCRIPTION"],
  A2: ["TRANSCRIPTION"],
  B1: [],
  B2: ["STORYBOARD"],
  C1: ["PLAN_SONORE"],
  C2: ["CAPTURES"],
  D1: ["STORYBOARD", "PLAN_SONORE"],
  D2: ["STORYBOARD", "TIMELINE"],
  D3: ["TIMELINE"],
  D4: ["STORYBOARD", "TIMELINE"],
  D5: ["STORYBOARD", "PLAN_SONORE"],
  E1: ["TIMELINE"],
  E2: ["TIMELINE", "TRANSCRIPTION"],
  E3: ["PLAN_SONORE"],
  E4: ["CAPTURES"],
  F1: ["TRANSCRIPTION"],
};

/** Points qui ne concernent qu'un partenariat : sans objet quand il n'y en a pas, quelles que soient les sources. */
const PARTNERSHIP_CHECKS: readonly CheckId[] = ["D3", "D4"];

export type Availability = Record<SourceKey, boolean>;

/** Sources absentes qui empêchent de vérifier ce point ; vide si le point est vérifiable. */
export function missingSourcesFor(id: CheckId, available: Availability, hasPartnership: boolean): SourceKey[] {
  if (!hasPartnership && PARTNERSHIP_CHECKS.includes(id)) return [];
  return CHECK_SOURCES[id].filter((source) => !available[source]);
}

/** Points rendus invérifiables par l'absence de cette source. */
export function checksNeeding(source: SourceKey, hasPartnership: boolean): CheckId[] {
  return CHECK_IDS.filter((id) => CHECK_SOURCES[id].includes(source) && (hasPartnership || !PARTNERSHIP_CHECKS.includes(id)));
}

// ---------------------------------------------------------------------------
// Agent responsable d'un « ko ».
// ---------------------------------------------------------------------------

/** Agents à qui un point peut être renvoyé : 1 à 9 (ni l'orchestrateur, ni l'analyste). */
export const RESPONSIBLE_AGENTS: readonly string[] = agentCatalog.filter((meta) => meta.id >= 1 && meta.id <= 9).map((meta) => meta.slug);

function simplify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** « 4 », « agent 04 », « Scénariste », « 04-scenariste » → « 04-scenariste » ; null si rien ne correspond. */
export function canonicalAgent(value: string): string | null {
  const simple = simplify(value);
  const numbered = /^(?:agent-)?0?(\d{1,2})(?:-|$)/.exec(simple);
  if (numbered) {
    const id = Number(numbered[1]);
    return agentCatalog.find((meta) => meta.id === id && RESPONSIBLE_AGENTS.includes(meta.slug))?.slug ?? null;
  }
  const match = agentCatalog.find(
    (meta) => RESPONSIBLE_AGENTS.includes(meta.slug) && (simplify(meta.name) === simple || meta.slug.slice(3) === simple),
  );
  return match?.slug ?? null;
}
