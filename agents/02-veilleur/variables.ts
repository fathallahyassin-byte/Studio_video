import type { z } from "zod";
import { outputSchema as analystSchema } from "@/agents/10-analyste/schema";

// Texte des {{VARIABLES}} du prompt. Une entrée vide devient une phrase explicite, jamais une chaîne vide.

export const learningsSchema = analystSchema.shape.enseignements;
export type Learning = z.infer<typeof learningsSchema>[number];

export const NO_SIGNALS = "aucun signal fourni cette semaine : toute idée est une hypothèse (hypothese = true).";
export const NO_LEARNINGS = "aucun (pas encore de rapport de l'analyste).";
export const NO_BACKLOG = "aucune vidéo sur les 90 derniers jours.";

export function formatSignals(text: string): string {
  return text.trim() === "" ? NO_SIGNALS : text.trim();
}

export function formatLearnings(learnings: readonly Learning[]): string {
  if (learnings.length === 0) return NO_LEARNINGS;
  return learnings
    .map((learning) => `- ${learning.observation} (confiance ${learning.confiance}, ${learning.nb_videos} vidéo(s)) → décision : ${learning.decision}`)
    .join("\n");
}

export function formatBacklog(titles: readonly string[]): string {
  if (titles.length === 0) return NO_BACKLOG;
  return titles.map((title) => `- ${title}`).join("\n");
}

/** Enseignements lus dans le contenu d'un AnalystReport ; un contenu illisible n'en donne aucun. */
export function readLearnings(reportContent: unknown): Learning[] {
  if (typeof reportContent !== "object" || reportContent === null || !("enseignements" in reportContent)) return [];
  const parsed = learningsSchema.safeParse(reportContent.enseignements);
  return parsed.success ? parsed.data : [];
}
