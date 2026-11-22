import type { z } from "zod";
import { outputSchema as scoutSchema } from "@/agents/02-veilleur/schema";
import { outputSchema as scriptSchema } from "@/agents/04-scenariste/schema";
import { outputSchema as qaSchema } from "@/agents/08-controle-qualite/schema";
import { outputSchema as analystSchema } from "@/agents/10-analyste/schema";

// Lecture des JSON stockés sur Video (ideaJson, scriptJson, qaJson…) avec les schémas des agents.
// Une donnée illisible donne null : l'écran l'affiche comme telle au lieu de planter.

export const ideaSchema = scoutSchema.shape.idees.element;

export type Idea = z.infer<typeof ideaSchema>;
export type Script = z.infer<typeof scriptSchema>;
export type QaReport = z.infer<typeof qaSchema>;
export type AnalystReportContent = z.infer<typeof analystSchema>;

function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const parseIdea = (value: unknown) => parseWith(ideaSchema, value);
export const parseScript = (value: unknown) => parseWith(scriptSchema, value);
export const parseQaReport = (value: unknown) => parseWith(qaSchema, value);
export const parseAnalystReport = (value: unknown) => parseWith(analystSchema, value);
