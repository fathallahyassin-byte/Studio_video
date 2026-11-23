import type { z } from "zod";
import { outputSchema as scriptSchema } from "@/agents/04-scenariste/schema";
import { readPublicationLabels, type PublicationLabels } from "@/agents/08-controle-qualite/labels";
import { outputSchema as qaSchema } from "@/agents/08-controle-qualite/schema";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { formatVideoNumber } from "@/lib/dashboard/format";
import type { Platform } from "@/lib/generated/prisma/client";
import { platformLabel, PLATFORMS } from "./platforms";
import type { PublicationVideo, TakenSlot } from "./ports";
import { formatSlot, MAX_HORIZON_MS, MIN_GAP_MS } from "./slots";

// Texte des {{VARIABLES}} du prompt et lecture de leurs sources. Une source qui manque devient une phrase explicite :
// le modèle ne croit jamais avoir reçu ce qui n'existe pas encore (créneaux de l'analyste, liste de mots-clés).

export type Script = z.infer<typeof scriptSchema>;
export type QaReport = z.infer<typeof qaSchema>;
export type Labels = Record<Platform, PublicationLabels>;

export const NOTE_HEADING = "NOTE DE L'HUMAIN (validation V3 ou reprise) : à respecter en priorité";
export const NO_KEYWORDS =
  "AUCUNE LISTE FOURNIE : la liste de mots-clés de la page de l'agent est vide. Déduis les mots-clés du script et de la bible, écrits comme les gens les tapent dans la barre de recherche.";
export const NO_ANALYST_SLOTS =
  "NON DISPONIBLE : l'analyste (agent 10) n'a encore produit aucun créneau recommandé (pas encore de statistiques). Aucun créneau n'a fait ses preuves : propose des heures raisonnables pour le public de la bible, sans les présenter comme venant de l'analyste.";

// ---------------------------------------------------------------------------
// Préconditions : sans V3 approuvée, script et rapport qualité lisibles, aucun appel.
// ---------------------------------------------------------------------------

export function requireV3Approval(video: Pick<PublicationVideo, "hasV3Approval">): void {
  if (!video.hasV3Approval) throw new AgentPreconditionError("Publication refusée : la vidéo n'a pas de validation V3 approuvée.");
}

export function readScript(scriptJson: unknown): Script {
  if (scriptJson === null || scriptJson === undefined) throw new AgentPreconditionError("La vidéo n'a pas de script (scriptJson vide) : rien à présenter.");
  const parsed = scriptSchema.safeParse(scriptJson);
  if (!parsed.success) throw new AgentPreconditionError("Le script de la vidéo est illisible (schéma du scénariste non respecté).");
  return parsed.data;
}

export function readQaReport(qaJson: unknown): QaReport {
  if (qaJson === null || qaJson === undefined) {
    throw new AgentPreconditionError("La vidéo n'a pas de rapport qualité (qaJson vide) : les étiquettes IA sont inconnues, publication impossible.");
  }
  const parsed = qaSchema.safeParse(qaJson);
  if (!parsed.success) throw new AgentPreconditionError("Le rapport qualité de la vidéo est illisible (schéma de l'agent 8 non respecté) : étiquettes IA inconnues.");
  return parsed.data;
}

/** Étiquettes imposées par le rapport qualité, dans la forme des colonnes de Publication. */
export function requireLabels(qaJson: unknown): Labels {
  readQaReport(qaJson);
  const labels = readPublicationLabels(qaJson);
  if (!labels) throw new AgentPreconditionError("Étiquettes IA illisibles dans le rapport qualité.");
  return labels;
}

/** Id de l'idée (Video.ideaJson.id), sinon celui du script. */
export function readIdeaId(idea: unknown, script: Script): string {
  if (typeof idea === "object" && idea !== null && "id" in idea && typeof idea.id === "string" && idea.id.trim() !== "") return idea.id.trim();
  return script.idee_id;
}

// ---------------------------------------------------------------------------
// Texte des variables.
// ---------------------------------------------------------------------------

const yesNo = (value: boolean) => (value ? "oui" : "non");

export function formatLabels(labels: Labels): string {
  return PLATFORMS.map(({ platform }) => {
    const entry = labels[platform];
    return `- ${platformLabel(platform)} : étiquette IA ${yesNo(entry.aiLabel)}, contenu de marque ${yesNo(entry.brandedContent)}`;
  }).join("\n");
}

/** {{RAPPORT_QA}} : décision, étiquettes et mentions (les 16 points de contrôle ne servent pas à la publication). */
export function formatQaReport(report: QaReport, labels: Labels): string {
  const summary = {
    decision: report.decision,
    etiquettes: report.etiquettes,
    mentions_a_incruster: report.mentions_a_incruster,
    resume_pour_humain: report.resume_pour_humain,
  };
  return [
    JSON.stringify(summary, null, 2),
    "Étiquettes imposées par ce rapport (vues par l'humain au GO final, recopiées telles quelles en code) :",
    formatLabels(labels),
  ].join("\n\n");
}

/** {{MOTS_CLES}} : une ligne par mot-clé, ou une phrase qui dit que la liste est vide. */
export function formatKeywords(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length === 0 ? NO_KEYWORDS : lines.map((line) => `- ${line}`).join("\n");
}

function formatTakenSlots(slots: readonly TakenSlot[]): string {
  if (slots.length === 0) return "Créneaux déjà pris par d'autres vidéos : aucun.";
  const lines = slots.map((slot) => `- ${formatSlot(slot.scheduledFor)} · ${platformLabel(slot.platform)} · ${formatVideoNumber(slot.videoNumber)}`);
  return `Créneaux déjà pris par d'autres vidéos (évite-les sur la même plateforme) :\n${lines.join("\n")}`;
}

export type SlotsInput = { now: Date; taken: readonly TakenSlot[]; note: string | null };

/**
 * {{CRENEAUX}} : l'analyste n'existe pas encore, on le dit ; puis la date du jour (le modèle ne la connaît pas),
 * les contraintes vérifiées en code, les créneaux pris, et la note de l'humain sous un intitulé explicite.
 */
export function formatSlotsVariable(input: SlotsInput): string {
  const hours = MIN_GAP_MS / 3_600_000;
  const days = MAX_HORIZON_MS / 86_400_000;
  const parts = [
    NO_ANALYST_SLOTS,
    `Date et heure actuelles (heure locale de publication) : ${formatSlot(input.now)}.`,
    `Contraintes vérifiées en code : chaque créneau est dans le futur, au plus ${days} jours après maintenant, et au moins ${hours} h sépare les créneaux de deux plateformes.`,
    formatTakenSlots(input.taken),
  ];
  const note = input.note?.trim();
  if (note) parts.push(`${NOTE_HEADING} :\n${note}`);
  return parts.join("\n\n");
}
