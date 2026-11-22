import { z } from "zod";

const critere = z.object({
  note: z.number().int().min(1).max(5),
  pourquoi: z.string().min(1),
});

export const outputSchema = z.object({
  candidates: z
    .array(
      z.object({
        niche: z.string(),
        public: z.string(),
        angle: z.string(),
        criteres: z.object({
          demande: critere,
          concurrence: critere,
          monetisation: critere,
          faisabilite_ia: critere,
          profondeur: critere,
          risque: critere,
          differenciation: critere,
        }),
        score_pondere: z.number(),
      }),
    )
    .min(8),
  top3: z
    .array(
      z.object({
        niche: z.string(),
        exemples_titres: z.array(z.string()).length(10),
        a_etudier: z.array(z.string()),
      }),
    )
    .length(3),
  recommandation: z.object({
    niche: z.string(),
    pourquoi: z.string(),
    risques: z.array(z.string()),
  }),
  plan_de_test: z.object({
    nb_videos: z.number().int().positive(),
    semaines: z.number().int().positive(),
    critere_validation: z.string(),
  }),
  bible: z.string().min(1),
});

export type Output = z.infer<typeof outputSchema>;
