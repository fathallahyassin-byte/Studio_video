import { z } from "zod";

// Réglages du veilleur, rangés dans Agent.settings (JSON partagé avec d'éventuels autres réglages).

export const MAX_SIGNALS_LENGTH = 8000;

const settingsSchema = z.looseObject({
  signaux: z.string().optional(),
  signauxMisAJour: z.string().optional(),
});

export type ScoutSignals = { text: string; updatedAt: string | null };

/** Les signaux de la semaine ; un réglage illisible compte comme vide. */
export function readSignals(settings: unknown): ScoutSignals {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) return { text: "", updatedAt: null };
  const updatedAt = parsed.data.signauxMisAJour ?? null;
  return { text: parsed.data.signaux ?? "", updatedAt: updatedAt !== null && !Number.isNaN(Date.parse(updatedAt)) ? updatedAt : null };
}

/** Réglages avec les nouveaux signaux, sans perdre les autres clés. */
export function withSignals(settings: unknown, text: string, now: Date): Record<string, unknown> {
  const parsed = settingsSchema.safeParse(settings);
  const base = parsed.success ? parsed.data : {};
  return { ...base, signaux: text.trim(), signauxMisAJour: now.toISOString() };
}
