import { parse } from "yaml";
import { z } from "zod";
import { outputSchema as scriptSchema } from "@/agents/04-scenariste/schema";
import { AgentPreconditionError } from "@/lib/agents/errors";
import type { ScriptBeatBounds } from "./rules";
import { outputSchema as storyboardSchema, type Output } from "./schema";

// Texte des {{VARIABLES}} du prompt et lecture de leurs sources (script, budgets, outils, bible).

export type Script = z.infer<typeof scriptSchema>;

export const CORRECTION_HEADING = "CORRECTION DEMANDÉE PAR L'HUMAIN (prioritaire sur le reste)";
export const NO_GENERATOR =
  "Aucun modèle image IA ni vidéo IA n'est configuré : n'utilise ni image_ia_animee ni video_ia, seulement texte_anime et stock.";

// ---------------------------------------------------------------------------
// Script validé (agent 4).
// ---------------------------------------------------------------------------

/** Précondition de buildVariables : sans script lisible, rien à découper, aucun appel. */
export function readScript(scriptJson: unknown): Script {
  if (scriptJson === null || scriptJson === undefined) {
    throw new AgentPreconditionError("La vidéo n'a pas de script (scriptJson vide) : rien à découper en plans.");
  }
  const parsed = scriptSchema.safeParse(scriptJson);
  if (!parsed.success) throw new AgentPreconditionError("Le script de la vidéo est illisible (schéma du scénariste non respecté).");
  return parsed.data;
}

export function scriptBeats(script: Script): ScriptBeatBounds[] {
  return script.beats.map((beat) => ({ n: beat.n, debut_s: beat.debut_s, fin_s: beat.fin_s }));
}

/** Fin du dernier beat : la durée que les plans doivent couvrir. */
export function scriptEnd(script: Script): number {
  return Math.max(...script.beats.map((beat) => beat.fin_s));
}

/** Lecture tolérante d'un storyboard enregistré (affichage, correction) : null s'il est illisible. */
export function parseStoredStoryboard(value: unknown): Output | null {
  const parsed = storyboardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * {{SCRIPT}} : le script en JSON. Une note de l'humain (renvoi depuis V3, reprise) suit sous un intitulé
 * explicite, avec le storyboard précédent s'il existe : le modèle corrige au lieu de repartir de zéro.
 */
export function formatScriptVariable(script: Script, note: string | null, previous: Output | null): string {
  const json = JSON.stringify(script, null, 2);
  const trimmedNote = note?.trim();
  if (!trimmedNote) return json;
  const correction = `${json}\n\n${CORRECTION_HEADING} :\n${trimmedNote}`;
  if (!previous) return correction;
  return `${correction}\n\nStoryboard précédent, à corriger selon cette note :\n${JSON.stringify(previous)}`;
}

// ---------------------------------------------------------------------------
// Budgets (.env).
// ---------------------------------------------------------------------------

export type RawBudgets = { videoAiSeconds: string | undefined; perVideo: string | undefined };

/** Montant ou durée positif lu dans .env ; null s'il est absent ou invalide. */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** BUDGET_SECONDES_VIDEO_IA : sans valeur lisible, le prompt ne peut pas être rempli (aucun appel). */
export function readVideoAiBudget(raw: RawBudgets): number {
  const value = parseAmount(raw.videoAiSeconds);
  if (value === null) throw new AgentPreconditionError("BUDGET_SECONDES_VIDEO_IA est absent ou invalide dans .env : renseigne un nombre de secondes.");
  return value;
}

/** BUDGET_PAR_VIDEO : null s'il est absent ou invalide (la génération payante est alors refusée). */
export function readVideoBudget(raw: RawBudgets): number | null {
  return parseAmount(raw.perVideo);
}

export function formatBudgetSeconds(value: number): string {
  return String(value);
}

// ---------------------------------------------------------------------------
// Outils visuels configurés.
// ---------------------------------------------------------------------------

export type ToolNames = { image: string | null; video: string | null };

/** {{OUTILS_VISUELS}} : ce qui est vraiment branché. Sans générateur, on le dit au modèle au lieu de le laisser inventer. */
export function formatVisualTools(tools: ToolNames): string {
  const lines = [
    tools.video ? `- Modèle vidéo IA : ${tools.video} (type video_ia)` : "- Modèle vidéo IA : aucun configuré (type video_ia interdit)",
    tools.image ? `- Modèle image IA : ${tools.image} (type image_ia_animee)` : "- Modèle image IA : aucun configuré (type image_ia_animee interdit)",
    "- Banque de vidéos libres de droits : pas de recherche automatique ; donne des mots-clés précis (type stock)",
    "- Animations de texte : faites au montage (type texte_anime)",
  ];
  const warning = tools.image === null && tools.video === null ? `\n${NO_GENERATOR}` : "";
  return `\n${lines.join("\n")}${warning}\n`;
}

// ---------------------------------------------------------------------------
// Bible : suffixe de style.
// ---------------------------------------------------------------------------

const styleSchema = z.object({ identite: z.object({ style_visuel_en: z.string() }) });

/** identite.style_visuel_en ; null s'il manque ou n'est pas rempli (« {{SUFFIXE_STYLE}} » du modèle de bible). */
export function readStyleSuffix(bible: string | null): string | null {
  if (bible === null) return null;
  let content: unknown;
  try {
    content = parse(bible);
  } catch {
    return null;
  }
  const parsed = styleSchema.safeParse(content);
  if (!parsed.success) return null;
  const suffix = parsed.data.identite.style_visuel_en.trim();
  return suffix === "" || suffix.includes("{{") ? null : suffix;
}
