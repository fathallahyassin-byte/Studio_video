import { z } from "zod";
import { outputSchema } from "./schema";

// Ce que contient Video.audioJson : la sortie normalisée du modèle (schema.ts) plus le bloc « production »,
// écrit en code une fois la voix générée et la musique choisie. Les lecteurs qui parsent avec outputSchema
// (contrôle qualité) ignorent ce bloc ; le monteur (agent 7) y lit la voix, sa durée et l'horodatage.

export const wordTimingSchema = z.object({ word: z.string(), startS: z.number(), endS: z.number() });

export const voiceSchema = z.object({
  url: z.string().min(1),
  fournisseur: z.string(),
  voix_id: z.string(),
  langue: z.string(),
  /** durée réelle mesurée par le moteur */
  duree_s: z.number().nonnegative(),
  mots: z.array(wordTimingSchema),
  horodatage: z.enum(["tts", "stt"]),
  /** coupes de coupes_si_trop_long appliquées en code (voix trop longue) */
  coupes_appliquees: z.array(z.string()),
  tentative: z.number().int().positive(),
});

export const trackSchema = z.object({
  titre: z.string(),
  url: z.string().min(1),
  fournisseur: z.string(),
  /** jamais vide : une piste sans licence n'est ni enregistrée ni utilisée */
  licence: z.string().trim().min(1),
  source: z.enum(["banque", "manuel"]),
});

export const productionSchema = z.object({
  /** mots du texte TTS divisés par le débit de la bible */
  duree_estimee_s: z.number().nonnegative(),
  duree_cible_s: z.tuple([z.number(), z.number()]),
  voix: voiceSchema,
  musique: trackSchema,
});

export const audioPlanSchema = outputSchema.extend({ production: productionSchema });

export type WordTimingJson = z.infer<typeof wordTimingSchema>;
export type VoiceJson = z.infer<typeof voiceSchema>;
export type TrackJson = z.infer<typeof trackSchema>;
export type Production = z.infer<typeof productionSchema>;
export type AudioPlan = z.infer<typeof audioPlanSchema>;

/** Lecture tolérante d'un plan sonore enregistré : null s'il est absent ou illisible. */
export function parseStoredAudioPlan(value: unknown): AudioPlan | null {
  const parsed = audioPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Lecture tolérante d'une sortie du modèle (dernier AgentRun réussi) : null si elle est illisible. */
export function parseStoredOutput(value: unknown): z.infer<typeof outputSchema> | null {
  const parsed = outputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
