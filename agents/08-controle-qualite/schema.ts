import { z } from "zod";

export const outputSchema = z.object({
  idee_id: z.string(),
  decision: z.enum(["GO", "GO_AVEC_CORRECTIONS", "NO_GO"]),
  controles: z
    .array(
      z.object({
        id: z.string().regex(/^[A-F]\d$/),
        statut: z.enum(["ok", "ko", "na"]),
        preuve: z.string(),
        correction: z.string().nullable(),
        agent_responsable: z.string().nullable(),
      }),
    )
    .min(1),
  etiquettes: z.object({
    tiktok_contenu_ia: z.boolean(),
    instagram_contenu_ia: z.boolean(),
    youtube_utilisation_ia: z.boolean(),
    contenu_de_marque: z.boolean(),
  }),
  mentions_a_incruster: z.array(z.string()),
  resume_pour_humain: z.string(),
});

export type Output = z.infer<typeof outputSchema>;
