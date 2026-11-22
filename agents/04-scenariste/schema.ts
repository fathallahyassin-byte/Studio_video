import { z } from "zod";

export const outputSchema = z.object({
  idee_id: z.string(),
  titre_interne: z.string(),
  accroches: z
    .array(
      z.object({
        type: z.enum(["question", "affirmation", "situation"]),
        voix: z.string(),
        texte_ecran: z.string(),
      }),
    )
    .length(3),
  beats: z
    .array(
      z.object({
        n: z.number().int().positive(),
        role: z.enum(["accroche", "contexte", "revelation", "chute", "boucle"]),
        debut_s: z.number().nonnegative(),
        fin_s: z.number().positive(),
        voix: z.string(),
        texte_ecran: z.string(),
        faits: z.array(z.string()),
        intention_visuelle: z.string(),
      }),
    )
    .min(3),
  nb_mots: z.number().int().positive(),
  duree_estimee_s: z.number().positive(),
  cta: z.string().nullable(),
  verifications: z.object({
    accroche_sans_son: z.boolean(),
    faits_tous_sources: z.boolean(),
    duree_ok: z.boolean(),
  }),
});

export type Output = z.infer<typeof outputSchema>;
