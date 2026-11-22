import { z } from "zod";
import type { ControlResult } from "@/agents/_shared/types";
import type { Output } from "./schema";

// Règles de l'agent 3 appliquées en code : fonctions pures, testées dans rules.test.ts.

export type Fact = Output["faits"][number];
export type Confidence = Fact["confiance"];

/** Nombre de faits demandé par le prompt (« Liste les 5 à 10 faits nécessaires »). */
export const MIN_FACTS = 5;
export const MAX_FACTS = 10;
/** « Une citation exacte fait moins de 15 mots. » */
export const MAX_QUOTE_WORDS = 14;

export const NO_SOURCES_TEXT = "aucune source fournie";
export const NO_RELIABLE_FACT_REASON =
  "Aucun fait assez fiable : le dossier ne contient aucun fait de confiance « eleve » ou « moyen ». Ajoute des sources, puis relance la recherche.";

const SOURCE_TO_FIND = "source a trouver";

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Une source n'est utilisable que si son URL est une vraie adresse http(s).
 * Vide, « source à trouver » ou autre texte (« N/A », « inconnue ») : la source reste à trouver.
 */
export function hasUsableSource(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "" || withoutAccents(trimmed).includes(SOURCE_TO_FIND)) return false;
  return URL.canParse(trimmed) && ["http:", "https:"].includes(new URL(trimmed).protocol);
}

/** Une URL vide ou marquée « source à trouver » force la confiance « faible » (AGENT.md). */
export function normalizeDossier(output: Output): Output {
  return {
    ...output,
    faits: output.faits.map((fact) => (hasUsableSource(fact.source.url) ? fact : { ...fact, confiance: "faible" })),
  };
}

export function isReliable(fact: Fact): boolean {
  return fact.confiance === "eleve" || fact.confiance === "moyen";
}

// ---------------------------------------------------------------------------
// Contrôles en code : chaque refus est renvoyé au modèle pour correction.
// ---------------------------------------------------------------------------

const passed: ControlResult = { ok: true };
const refuse = (reason: string): ControlResult => ({ ok: false, reason });

export function checkReplacementAngle(output: Output): ControlResult {
  if (output.verdict !== "angle_a_changer") return passed;
  return output.angle_de_remplacement?.trim()
    ? passed
    : refuse("Le verdict est « angle_a_changer » : « angle_de_remplacement » doit proposer un angle (texte non vide).");
}

export function checkFactCount(output: Output): ControlResult {
  const count = output.faits.length;
  if (count > MAX_FACTS) return refuse(`${count} faits : garde les ${MAX_FACTS} plus utiles au maximum.`);
  if (count < MIN_FACTS && output.verdict !== "angle_a_changer") {
    return refuse(`${count} fait(s) seulement : il en faut au moins ${MIN_FACTS} pour tenir la promesse de l'idée.`);
  }
  return passed;
}

export function checkUniqueFactIds(output: Output): ControlResult {
  const ids = output.faits.map((fact) => fact.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  return duplicates.length === 0 ? passed : refuse(`Identifiants de faits en double : ${duplicates.join(", ")}.`);
}

const QUOTE_PATTERN = /«([^»]*)»|“([^”]*)”|"([^"]*)"/g;

/** Passages entre guillemets (« », “ ” ou ""), sans les guillemets. */
export function extractQuotes(text: string): string[] {
  return [...text.matchAll(QUOTE_PATTERN)].map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim()).filter((quote) => quote !== "");
}

const wordCount = (text: string) => text.split(/\s+/).filter((word) => word !== "").length;

export function checkQuoteLength(output: Output): ControlResult {
  const texts = [
    ...output.faits.flatMap((fact) => [{ where: fact.id, text: fact.fait }, { where: fact.id, text: fact.formulation_prudente }]),
    { where: "detail_accroche", text: output.detail_accroche },
  ];
  const tooLong = texts.flatMap(({ where, text }) =>
    extractQuotes(text)
      .filter((quote) => wordCount(quote) > MAX_QUOTE_WORDS)
      .map((quote) => `${where} (${wordCount(quote)} mots)`),
  );
  return tooLong.length === 0
    ? passed
    : refuse(`Citations trop longues : ${tooLong.join(", ")}. Une citation exacte fait moins de 15 mots ; reformule le reste.`);
}

export function checkIdeaId(output: Output, expectedIdeaId: string | null): ControlResult {
  if (expectedIdeaId === null || output.idee_id === expectedIdeaId) return passed;
  return refuse(`« idee_id » vaut « ${output.idee_id} » : reprends l'id de l'idée fournie, « ${expectedIdeaId} ».`);
}

export function checkDossier(output: Output, expectedIdeaId: string | null): ControlResult[] {
  return [
    checkReplacementAngle(output),
    checkFactCount(output),
    checkUniqueFactIds(output),
    checkQuoteLength(output),
    checkIdeaId(output, expectedIdeaId),
  ];
}

// ---------------------------------------------------------------------------
// Après la sortie : passer au script ou bloquer la vidéo.
// ---------------------------------------------------------------------------

export type ResearchOutcome = { kind: "advance" } | { kind: "block"; reason: string };

export function decideOutcome(output: Output): ResearchOutcome {
  if (output.verdict === "angle_a_changer") {
    const angle = output.angle_de_remplacement?.trim() || "aucun angle proposé";
    return { kind: "block", reason: `Angle à changer. Angle de remplacement proposé : ${angle}` };
  }
  if (!output.faits.some(isReliable)) return { kind: "block", reason: NO_RELIABLE_FACT_REASON };
  return { kind: "advance" };
}

// ---------------------------------------------------------------------------
// Variables du prompt.
// ---------------------------------------------------------------------------

const ideaWithId = z.object({ id: z.string().min(1) });

/** Id de l'idée stockée dans Video.ideaJson, s'il existe. */
export function readIdeaId(idea: unknown): string | null {
  const parsed = ideaWithId.safeParse(idea);
  return parsed.success ? parsed.data.id : null;
}

/** {{IDEE}} : l'idée en JSON, suivie de la note de l'humain (validation V1 ou reprise) s'il y en a une. */
export function formatIdeaVariable(idea: unknown, note: string | null): string {
  const json = JSON.stringify(idea, null, 2);
  const trimmedNote = note?.trim();
  return trimmedNote ? `${json}\n\nNote de l'humain, à prendre en compte : ${trimmedNote}` : json;
}

/** {{SOURCES}} : un lien par ligne, ou un texte explicite quand l'humain n'en a fourni aucun. */
export function formatSourcesVariable(urls: readonly string[]): string {
  const cleaned = urls.map((url) => url.trim()).filter((url) => url !== "");
  return cleaned.length === 0 ? NO_SOURCES_TEXT : cleaned.map((url) => `- ${url}`).join("\n");
}
