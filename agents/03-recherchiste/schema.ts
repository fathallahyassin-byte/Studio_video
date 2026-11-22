import { z } from "zod";

export const outputSchema = z.object({
  idee_id: z.string(),
  verdict: z.enum(["ok", "ok_avec_reserves", "angle_a_changer"]),
  faits: z
    .array(
      z.object({
        id: z.string().regex(/^F\d+$/),
        fait: z.string(),
        source: z.object({
          titre: z.string(),
          auteur: z.string(),
          date: z.string(),
          url: z.string(),
        }),
        type_source: z.enum(["primaire", "institutionnelle", "presse", "encyclopedie", "autre"]),
        confiance: z.enum(["eleve", "moyen", "faible"]),
        formulation_prudente: z.string(),
      }),
    )
    .min(1),
  detail_accroche: z.string(),
  idee_recue: z.string(),
  erreurs_frequentes: z.array(z.string()),
  points_sensibles: z.array(z.string()),
  angle_de_remplacement: z.string().nullable(),
});

export type Output = z.infer<typeof outputSchema>;
