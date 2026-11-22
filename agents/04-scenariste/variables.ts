import { parse } from "yaml";
import { z } from "zod";
import { outputSchema as dossierSchema } from "@/agents/03-recherchiste/schema";
import { outputSchema as analystSchema } from "@/agents/10-analyste/schema";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { checkBible } from "@/lib/bible/bible";
import type { FactIndex, ScriptTarget } from "./rules";
import { outputSchema as scriptSchema, type Output } from "./schema";

// Texte des {{VARIABLES}} du prompt et lecture de leurs sources. Une entrée vide devient une phrase explicite.

export type Dossier = z.infer<typeof dossierSchema>;
export type Learning = z.infer<typeof analystSchema>["enseignements"][number];

export const NO_LEARNINGS = "aucun (pas encore de rapport de l'analyste).";
export const NO_PUBLISHED_SCRIPTS = "aucun (pas encore de vidéo publiée).";
export const CORRECTION_HEADING = "CORRECTION DEMANDÉE PAR L'HUMAIN (prioritaire sur le reste)";

// ---------------------------------------------------------------------------
// Bible : durée cible et débit de la voix.
// ---------------------------------------------------------------------------

/** checkBible valide déjà ces clés ; on relit le débit, absent des champs du formulaire. */
const speechRateSchema = z.object({ format_video: z.object({ debit_voix_mots_par_s: z.number().positive() }) });

/** {{DUREE_S}} = milieu de format_video.duree_cible_s ; le débit sert au recomptage des mots. */
export function parseScriptTarget(bible: string): { ok: true; target: ScriptTarget } | { ok: false; error: string } {
  const checked = checkBible(bible);
  if (!checked.ok) return { ok: false, error: checked.error };
  const rate = speechRateSchema.safeParse(parse(bible));
  if (!rate.success) return { ok: false, error: "format_video.debit_voix_mots_par_s manque." };
  const { dureeMin, dureeMax } = checked.fields;
  return {
    ok: true,
    target: {
      durationS: (dureeMin + dureeMax) / 2,
      minDurationS: dureeMin,
      maxDurationS: dureeMax,
      wordsPerSecond: rate.data.format_video.debit_voix_mots_par_s,
    },
  };
}

/** Précondition de buildVariables : sans bible lisible, ni {{DUREE_S}} ni recomptage possible. */
export function readScriptTarget(bible: string | null): ScriptTarget {
  if (bible === null) throw new AgentPreconditionError("Aucune bible n'est adoptée : impossible de fixer la durée cible du script.");
  const parsed = parseScriptTarget(bible);
  if (!parsed.ok) throw new AgentPreconditionError(`Bible inutilisable pour le scénariste : ${parsed.error}`);
  return parsed.target;
}

/** 77.5 → « 77.5 », 78 → « 78 » */
export function formatDuration(seconds: number): string {
  return String(Math.round(seconds * 10) / 10);
}

// ---------------------------------------------------------------------------
// Idée et dossier factuel.
// ---------------------------------------------------------------------------

const ideaWithId = z.object({ id: z.string().min(1) });

export function readIdeaId(idea: unknown): string | null {
  const parsed = ideaWithId.safeParse(idea);
  return parsed.success ? parsed.data.id : null;
}

/** Précondition : sans dossier lisible, le scénariste n'a aucun fait à citer. */
export function readDossier(dossierJson: unknown): Dossier {
  if (dossierJson === null || dossierJson === undefined) {
    throw new AgentPreconditionError("La vidéo n'a pas de dossier factuel (dossierJson vide) : relance d'abord le recherchiste.");
  }
  const parsed = dossierSchema.safeParse(dossierJson);
  if (!parsed.success) throw new AgentPreconditionError("Le dossier factuel de la vidéo est illisible (schéma du recherchiste non respecté).");
  return parsed.data;
}

/** Lecture tolérante (affichage) : null si le dossier est absent ou illisible. */
export function parseStoredDossier(dossierJson: unknown): Dossier | null {
  const parsed = dossierSchema.safeParse(dossierJson);
  return parsed.success ? parsed.data : null;
}

export function indexFacts(dossier: Dossier): FactIndex {
  return new Map(dossier.faits.map((fact) => [fact.id.trim(), fact.confiance]));
}

/** Lecture tolérante d'un script enregistré (affichage, scripts précédents) : null s'il est illisible. */
export function parseStoredScript(value: unknown): Output | null {
  const parsed = scriptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * {{IDEE}} : l'idée en JSON. Si l'humain a laissé une note (correction V2, reprise), elle suit sous un
 * intitulé explicite, avec le script précédent quand il existe : le modèle corrige au lieu de repartir de zéro.
 * La note va ici plutôt que dans {{APPRENTISSAGES}}, que le prompt présente comme les enseignements de l'analyste.
 */
export function formatIdeaVariable(idea: unknown, note: string | null, previousScript: Output | null): string {
  const json = JSON.stringify(idea, null, 2);
  const trimmedNote = note?.trim();
  if (!trimmedNote) return json;
  const correction = `${json}\n\n${CORRECTION_HEADING} :\n${trimmedNote}`;
  if (!previousScript) return correction;
  return `${correction}\n\nScript précédent, à corriger selon cette note :\n${JSON.stringify(previousScript)}`;
}

export function formatDossierVariable(dossier: Dossier): string {
  return JSON.stringify(dossier, null, 2);
}

// ---------------------------------------------------------------------------
// Enseignements de l'analyste et derniers scripts publiés.
// ---------------------------------------------------------------------------

const learningsSchema = analystSchema.shape.enseignements;

/** Enseignements lus dans le contenu d'un AnalystReport ; un contenu illisible n'en donne aucun. */
export function readLearnings(reportContent: unknown): Learning[] {
  const parsed = z.object({ enseignements: learningsSchema }).safeParse(reportContent);
  return parsed.success ? parsed.data.enseignements : [];
}

export function formatLearnings(learnings: readonly Learning[]): string {
  if (learnings.length === 0) return NO_LEARNINGS;
  return learnings
    .map((learning) => `- ${learning.observation} (confiance ${learning.confiance}, ${learning.nb_videos} vidéo(s)) → décision : ${learning.decision}`)
    .join("\n");
}

/** Résumé d'un script publié : ce qu'il faut pour s'en différencier (ouverture, ordre, chute), sans tout le texte. */
export function summarizeScript(script: Output): string {
  const opening = script.beats[0]?.voix ?? "";
  const ending = script.beats.at(-1)?.voix ?? "";
  const hookType = script.accroches[0]?.type ?? "inconnu";
  return [
    `- « ${script.titre_interne} »`,
    `  ouverture (${hookType}) : ${opening}`,
    `  ordre : ${script.beats.map((beat) => beat.role).join(" → ")}`,
    `  fin : ${ending}`,
  ].join("\n");
}

export function formatPublishedScripts(scripts: readonly unknown[]): string {
  const readable = scripts.map(parseStoredScript).filter((script): script is Output => script !== null);
  return readable.length === 0 ? NO_PUBLISHED_SCRIPTS : readable.map(summarizeScript).join("\n");
}
