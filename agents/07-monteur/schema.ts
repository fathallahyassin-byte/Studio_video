import { z } from "zod";

const t = z.number().nonnegative();

export const outputSchema = z.object({
  idee_id: z.string(),
  duree_totale_s: z.number().positive(),
  export: z.object({
    largeur: z.literal(1080),
    hauteur: z.literal(1920),
    fps: z.literal(30),
    codec: z.literal("h264"),
    audio: z.literal("aac_48k"),
  }),
  pistes: z.object({
    video: z.array(
      z.object({
        plan: z.string(),
        src: z.string(),
        debut_s: t,
        fin_s: t,
        mouvement: z.string(),
        transition_entree: z.string(),
        manquant: z.boolean(),
      }),
    ),
    texte: z.array(
      z.object({ texte: z.string(), debut_s: t, fin_s: t, position: z.string(), animation: z.string() }),
    ),
    sous_titres: z.array(z.object({ mots: z.string(), debut_s: t, fin_s: t, mot_actif: z.string() })),
    audio: z.array(
      z.object({
        type: z.enum(["voix", "musique", "effet"]),
        src: z.string(),
        debut_s: t,
        volume_db: z.number(),
        ducking: z.boolean(),
      }),
    ),
  }),
  alertes: z.array(z.string()),
});

export type Output = z.infer<typeof outputSchema>;
