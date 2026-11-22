import type { z } from "zod";
import { outputSchema as dossierSchema } from "@/agents/03-recherchiste/schema";
import { outputSchema as scriptSchema } from "@/agents/04-scenariste/schema";
import { outputSchema as storyboardSchema } from "@/agents/05-directeur-artistique/schema";
import { outputSchema as audioSchema } from "@/agents/06-voix-son/schema";
import { outputSchema as timelineSchema } from "@/agents/07-monteur/schema";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { checkBible } from "@/lib/bible/bible";
import { formatVideoNumber } from "@/lib/dashboard/format";
import { checksNeeding, sourceLabels, type Availability, type SourceKey } from "./checklist";
import type { PublishedVideo, QaAsset, QaVideo, RenderEvidence } from "./ports";
import type { MediaFacts, QaContext } from "./rules";
import { outputSchema as reportSchema, type Output } from "./schema";

// Texte des {{VARIABLES}} du prompt et lecture de leurs sources. Une source absente devient une phrase explicite,
// qui dit au modèle quels points seront marqués « non vérifié » : il ne croit jamais avoir vu ce qui manque.

export type Dossier = z.infer<typeof dossierSchema>;
export type Script = z.infer<typeof scriptSchema>;
export type Storyboard = z.infer<typeof storyboardSchema>;
export type AudioPlan = z.infer<typeof audioSchema>;
export type Timeline = z.infer<typeof timelineSchema>;

export const NO_PARTNERSHIP = "aucun";
export const NO_HISTORY = "aucune (pas encore de vidéo publiée).";
export const NOTE_HEADING = "NOTE DE L'HUMAIN (renvoi depuis la validation V3 ou reprise) : à vérifier en priorité";

// ---------------------------------------------------------------------------
// Préconditions : sans dossier ni script, il n'y a rien à contrôler.
// ---------------------------------------------------------------------------

export function readDossier(dossierJson: unknown): Dossier {
  if (dossierJson === null || dossierJson === undefined) {
    throw new AgentPreconditionError("La vidéo n'a pas de dossier factuel (dossierJson vide) : impossible de vérifier les faits.");
  }
  const parsed = dossierSchema.safeParse(dossierJson);
  if (!parsed.success) throw new AgentPreconditionError("Le dossier factuel de la vidéo est illisible (schéma du recherchiste non respecté).");
  return parsed.data;
}

export function readScript(scriptJson: unknown): Script {
  if (scriptJson === null || scriptJson === undefined) {
    throw new AgentPreconditionError("La vidéo n'a pas de script (scriptJson vide) : rien à contrôler.");
  }
  const parsed = scriptSchema.safeParse(scriptJson);
  if (!parsed.success) throw new AgentPreconditionError("Le script de la vidéo est illisible (schéma du scénariste non respecté).");
  return parsed.data;
}

export function readIdeaId(idea: unknown): string | null {
  if (typeof idea !== "object" || idea === null || !("id" in idea)) return null;
  return typeof idea.id === "string" && idea.id.trim() !== "" ? idea.id.trim() : null;
}

// ---------------------------------------------------------------------------
// Sources facultatives : présentes, absentes ou illisibles.
// ---------------------------------------------------------------------------

export type Optional<T> = { status: "ok"; value: T } | { status: "absent" } | { status: "unreadable" };

function readOptional<T>(schema: z.ZodType<T>, value: unknown): Optional<T> {
  if (value === null || value === undefined) return { status: "absent" };
  const parsed = schema.safeParse(value);
  return parsed.success ? { status: "ok", value: parsed.data } : { status: "unreadable" };
}

function readText(value: string | null): Optional<string> {
  return value !== null && value.trim() !== "" ? { status: "ok", value: value.trim() } : { status: "absent" };
}

function readCaptures(value: string[] | null): Optional<string[]> {
  const captures = (value ?? []).map((capture) => capture.trim()).filter((capture) => capture !== "");
  return captures.length > 0 ? { status: "ok", value: captures } : { status: "absent" };
}

export type QaSources = {
  storyboard: Optional<Storyboard>;
  audio: Optional<AudioPlan>;
  timeline: Optional<Timeline>;
  transcription: Optional<string>;
  captures: Optional<string[]>;
};

export function readSources(video: QaVideo, evidence: RenderEvidence): QaSources {
  return {
    storyboard: readOptional(storyboardSchema, video.storyboard),
    audio: readOptional(audioSchema, video.audio),
    timeline: readOptional(timelineSchema, video.timeline),
    transcription: readText(evidence.transcription),
    captures: readCaptures(evidence.captures),
  };
}

export function availability(sources: QaSources): Availability {
  return {
    STORYBOARD: sources.storyboard.status === "ok",
    PLAN_SONORE: sources.audio.status === "ok",
    TIMELINE: sources.timeline.status === "ok",
    TRANSCRIPTION: sources.transcription.status === "ok",
    CAPTURES: sources.captures.status === "ok",
  };
}

const AI_PLAN_TYPES: readonly Storyboard["plans"][number]["type"][] = ["image_ia_animee", "video_ia"];

export function mediaFacts(sources: QaSources): MediaFacts {
  const plans = sources.storyboard.status === "ok" ? sources.storyboard.value.plans : null;
  return {
    realisticAi: plans === null ? null : plans.some((plan) => plan.label_ia_requis),
    aiVisuals: plans === null ? null : plans.some((plan) => AI_PLAN_TYPES.includes(plan.type)),
    // La voix off vient toujours de la synthèse vocale (CLAUDE.md §2).
    aiVoice: sources.audio.status === "ok" ? sources.audio.value.texte_tts.trim() !== "" : null,
  };
}

/** « aucun » quand le champ est vide ; sinon le texte saisi (marque et contrepartie). */
export function readPartnership(partnership: string): string {
  const trimmed = partnership.trim();
  return trimmed === "" || trimmed.toLowerCase() === NO_PARTNERSHIP ? NO_PARTNERSHIP : trimmed;
}

/** Durée cible de la bible de l'appel ; null si elle manque (la durée n'est alors pas recalculée en code). */
export function readDurationTarget(bible: string | null): QaContext["durationTarget"] {
  if (bible === null) return null;
  const checked = checkBible(bible);
  return checked.ok ? { minS: checked.fields.dureeMin, maxS: checked.fields.dureeMax } : null;
}

export function buildQaContext(video: QaVideo, evidence: RenderEvidence, bible: string | null): QaContext {
  const sources = readSources(video, evidence);
  return {
    ideaId: readIdeaId(video.idea),
    hasPartnership: readPartnership(video.partnership) !== NO_PARTNERSHIP,
    available: availability(sources),
    media: mediaFacts(sources),
    durationTarget: readDurationTarget(bible),
    timelineDurationS: sources.timeline.status === "ok" ? sources.timeline.value.duree_totale_s : null,
  };
}

// ---------------------------------------------------------------------------
// Texte des variables.
// ---------------------------------------------------------------------------

export function formatUnavailable(source: SourceKey, status: "absent" | "unreadable", hasPartnership: boolean): string {
  const why = status === "absent" ? "n'a pas été produit(e) pour cette vidéo" : "est illisible (schéma non respecté)";
  const checks = checksNeeding(source, hasPartnership).join(", ");
  return `NON DISPONIBLE : ${sourceLabels[source]} ${why}. Ne présume rien de son contenu. Les points ${checks} sont marqués « ko » (non vérifié) en code.`;
}

function formatOptionalJson<T>(source: SourceKey, value: Optional<T>, hasPartnership: boolean): string {
  return value.status === "ok" ? JSON.stringify(value.value, null, 2) : formatUnavailable(source, value.status, hasPartnership);
}

const VISUAL_ASSETS: readonly QaAsset["type"][] = ["IMAGE", "VIDEO"];
const AUDIO_ASSETS: readonly QaAsset["type"][] = ["VOICE", "MUSIC"];

function formatAssets(title: string, assets: readonly QaAsset[]): string {
  if (assets.length === 0) return "";
  const lines = assets.map((asset) => {
    const plan = asset.planId ? ` ${asset.planId}` : "";
    const license = asset.license?.trim() ? `licence : ${asset.license.trim()}` : "licence non renseignée";
    return `- ${asset.type}${plan} · fournisseur : ${asset.provider} · ${license}`;
  });
  return `\n\n${title} :\n${lines.join("\n")}`;
}

export function formatStoryboard(sources: QaSources, assets: readonly QaAsset[], hasPartnership: boolean): string {
  const visuals = assets.filter((asset) => VISUAL_ASSETS.includes(asset.type));
  return formatOptionalJson("STORYBOARD", sources.storyboard, hasPartnership) + formatAssets("Fichiers visuels enregistrés", visuals);
}

export function formatAudioPlan(sources: QaSources, assets: readonly QaAsset[], hasPartnership: boolean): string {
  const audio = assets.filter((asset) => AUDIO_ASSETS.includes(asset.type));
  return formatOptionalJson("PLAN_SONORE", sources.audio, hasPartnership) + formatAssets("Fichiers audio enregistrés", audio);
}

export function formatTimeline(sources: QaSources, hasPartnership: boolean): string {
  return formatOptionalJson("TIMELINE", sources.timeline, hasPartnership);
}

export function formatTranscription(sources: QaSources, hasPartnership: boolean): string {
  return sources.transcription.status === "ok" ? sources.transcription.value : formatUnavailable("TRANSCRIPTION", "absent", hasPartnership);
}

export function formatCaptures(sources: QaSources, hasPartnership: boolean): string {
  if (sources.captures.status !== "ok") return formatUnavailable("CAPTURES", "absent", hasPartnership);
  return sources.captures.value.map((capture, index) => `${index + 1}. ${capture}`).join("\n");
}

// ---------------------------------------------------------------------------
// Historique : un résumé compact par vidéo publiée (titre, accroche, structure, plans).
// ---------------------------------------------------------------------------

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => `${value} ×${count}`).join(", ");
}

export function summarizePublished(video: PublishedVideo): string {
  const head = `- ${formatVideoNumber(video.number)} « ${video.title} »`;
  const script = scriptSchema.safeParse(video.script);
  if (!script.success) return `${head} · structure inconnue (script illisible)`;
  const hook = script.data.accroches[0];
  const parts = [
    head,
    hook ? `accroche (${hook.type}) : « ${hook.voix} »` : "accroche inconnue",
    `structure : ${script.data.beats.map((beat) => beat.role).join(" → ")}`,
  ];
  const storyboard = storyboardSchema.safeParse(video.storyboard);
  if (storyboard.success) parts.push(`plans : ${countBy(storyboard.data.plans.map((plan) => plan.type))}`);
  return parts.join(" · ");
}

export function formatHistory(published: readonly PublishedVideo[]): string {
  return published.length === 0 ? NO_HISTORY : published.map(summarizePublished).join("\n");
}

/** Rapport précédent en une ligne par point ko : le modèle revérifie ce qui avait été signalé. */
export function summarizePreviousReport(previous: unknown): string | null {
  const parsed = reportSchema.safeParse(previous);
  if (!parsed.success) return null;
  const failed = parsed.data.controles.filter((check) => check.statut === "ko");
  const lines = failed.map((check) => `- ${check.id} : ${check.preuve}${check.correction ? ` → correction : ${check.correction}` : ""}`);
  return [`Rapport précédent : ${parsed.data.decision}.`, ...lines].join("\n");
}

/**
 * {{HISTORIQUE}}, suivi de la note de l'humain quand il y en a une (renvoi en contrôle depuis V3, reprise).
 * La note va en fin d'ENTRÉES, juste avant la check-list, sous un intitulé explicite : aucune variable n'est inventée.
 */
export function formatHistoryVariable(published: readonly PublishedVideo[], note: string | null, previousReport: unknown): string {
  const history = formatHistory(published);
  const trimmedNote = note?.trim();
  if (!trimmedNote) return history;
  const previous = summarizePreviousReport(previousReport);
  return [history, `${NOTE_HEADING} :\n${trimmedNote}`, previous].filter((part) => part !== null).join("\n\n");
}

export function parseStoredReport(value: unknown): Output | null {
  const parsed = reportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
