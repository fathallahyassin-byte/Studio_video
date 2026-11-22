import { z } from "zod";

export const outputSchema = z.object({
  idee_id: z.string(),
  texte_tts: z.string().min(1),
  prononciations: z.array(z.object({ mot: z.string(), phonetique: z.string() })),
  direction_par_beat: z.array(
    z.object({
      beat: z.number().int().positive(),
      ton: z.string(),
      vitesse: z.number().min(0.8).max(1.1),
      mots_appuyes: z.array(z.string()),
    }),
  ),
  musique: z.object({
    ambiance: z.string(),
    bpm: z.number().int().positive(),
    instruments: z.array(z.string()),
    evolution: z.string(),
    mots_cles_recherche: z.array(z.string()),
    licence_requise: z.string(),
  }),
  effets: z.array(z.object({ t_s: z.number().nonnegative(), effet: z.string(), plan: z.string() })).max(8),
  mixage: z.object({
    cible_lufs: z.number(),
    musique_sous_voix_db: z.number(),
    ducking: z.boolean(),
  }),
  coupes_si_trop_long: z.array(z.string()),
});

export type Output = z.infer<typeof outputSchema>;
