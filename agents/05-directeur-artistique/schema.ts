import { z } from "zod";

export const outputSchema = z.object({
  idee_id: z.string(),
  plans: z
    .array(
      z.object({
        id: z.string().regex(/^P\d+$/),
        beat: z.number().int().positive(),
        debut_s: z.number().nonnegative(),
        fin_s: z.number().positive(),
        type: z.enum(["texte_anime", "image_ia_animee", "video_ia", "stock"]),
        description_fr: z.string(),
        prompt_en: z.string().nullable(),
        negative_prompt_en: z.string().nullable(),
        mouvement: z.string(),
        mots_cles_stock: z.array(z.string()),
        texte_ecran: z.string(),
        position_texte: z.enum(["haut", "centre", "bas_zone_sure"]),
        transition_sortie: z.enum(["cut", "whip", "zoom", "fondu"]),
        label_ia_requis: z.boolean(),
      }),
    )
    .min(1),
  secondes_video_ia: z.number().nonnegative(),
  personnages_recurrents: z.array(z.object({ nom: z.string(), description_en: z.string() })),
  couverture: z.object({ plan: z.string(), texte: z.string() }),
});

export type Output = z.infer<typeof outputSchema>;
