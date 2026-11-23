import { z } from "zod";

// Mots-clés de la niche ({{MOTS_CLES}}), tenus sur la page de l'agent et rangés dans Agent.settings
// (JSON partagé avec d'éventuels autres réglages : les autres clés sont conservées).

export const MAX_KEYWORDS_LENGTH = 4000;

const settingsSchema = z.looseObject({
  motsCles: z.string().optional(),
  motsClesMisAJour: z.string().optional(),
});

export type PublicationKeywords = { text: string; updatedAt: string | null };

/** La liste de mots-clés ; un réglage illisible compte comme vide. */
export function readKeywords(settings: unknown): PublicationKeywords {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) return { text: "", updatedAt: null };
  const updatedAt = parsed.data.motsClesMisAJour ?? null;
  return { text: parsed.data.motsCles ?? "", updatedAt: updatedAt !== null && !Number.isNaN(Date.parse(updatedAt)) ? updatedAt : null };
}

/** Réglages avec la nouvelle liste, sans perdre les autres clés. */
export function withKeywords(settings: unknown, text: string, now: Date): Record<string, unknown> {
  const parsed = settingsSchema.safeParse(settings);
  const base = parsed.success ? parsed.data : {};
  return { ...base, motsCles: cleanKeywords(text), motsClesMisAJour: now.toISOString() };
}

/** Une ligne par mot-clé ou requête, sans ligne vide ni doublon. */
export function cleanKeywords(text: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/).map((entry) => entry.trim())) {
    const key = line.toLowerCase();
    if (line === "" || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n");
}
