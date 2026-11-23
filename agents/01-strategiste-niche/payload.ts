import { z } from "zod";
import { AgentInputError } from "@/lib/agents/errors";
import { splitLines } from "@/lib/bible/bible";

// Entrées du formulaire de la page de l'agent 1, transmises au worker dans AgentJob.payload.

export const MAX_LINES = 30;
export const MAX_LINE_LENGTH = 200;
export const MAX_GOAL_LENGTH = 300;

const line = z.string().trim().min(1).max(MAX_LINE_LENGTH);

export const strategyPayloadSchema = z.object({
  /** pistes de niches, peut être vide : le modèle complète jusqu'à 12 */
  pistes: z.array(line).max(MAX_LINES),
  heuresParSemaine: z.number().positive().max(100),
  /** en euros, outils et générations compris */
  budgetMensuel: z.number().min(0).max(100_000),
  objectifRevenus: z.string().trim().min(1).max(MAX_GOAL_LENGTH),
  /** ce que l'humain refuse de faire, une ligne par refus */
  refus: z.array(line).max(MAX_LINES),
});

export type StrategyPayload = z.infer<typeof strategyPayloadSchema>;

/** Lecture côté worker : un payload invalide arrête tout avant l'appel au modèle, et la tâche échoue sans nouvel essai. */
export function readStrategyPayload(payload: unknown): StrategyPayload {
  const parsed = strategyPayloadSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "payload"))].join(", ");
  throw new AgentInputError(`Formulaire du stratège invalide (${fields}) : relance l'analyse depuis sa page.`);
}

/** « 12,5 » comme « 12.5 » ; vide → NaN (refusé). */
function toNumber(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value.trim().replace(",", "."));
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Champs bruts du formulaire (FormData) → payload validé, ou message pour l'humain. */
export function parseStrategyForm(fields: Readonly<Record<string, unknown>>): { ok: true; payload: StrategyPayload } | { ok: false; message: string } {
  const parsed = strategyPayloadSchema.safeParse({
    pistes: splitLines(toText(fields.pistes)),
    heuresParSemaine: toNumber(fields.heuresParSemaine),
    budgetMensuel: toNumber(fields.budgetMensuel),
    objectifRevenus: toText(fields.objectifRevenus),
    refus: splitLines(toText(fields.refus)),
  });
  if (parsed.success) return { ok: true, payload: parsed.data };
  return { ok: false, message: formMessage(parsed.error.issues.map((issue) => String(issue.path[0] ?? ""))) };
}

const fieldMessages: Record<string, string> = {
  pistes: `Pistes : ${MAX_LINES} lignes au plus, ${MAX_LINE_LENGTH} caractères par ligne.`,
  heuresParSemaine: "Heures par semaine : un nombre supérieur à 0 (100 au plus).",
  budgetMensuel: "Budget mensuel : un montant en euros, 0 ou plus.",
  objectifRevenus: `Objectif de revenus : obligatoire, ${MAX_GOAL_LENGTH} caractères au plus.`,
  refus: `Ce que tu refuses de faire : ${MAX_LINES} lignes au plus, ${MAX_LINE_LENGTH} caractères par ligne.`,
};

function formMessage(fields: readonly string[]): string {
  const messages = [...new Set(fields)].map((field) => fieldMessages[field]).filter((message) => message !== undefined);
  return messages.length > 0 ? messages.join(" ") : "Formulaire invalide.";
}
