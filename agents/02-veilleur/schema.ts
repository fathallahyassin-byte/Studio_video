import { z } from "zod";

const note = z.number().int().min(1).max(5);

export const outputSchema = z.object({
  semaine: z.string().regex(/^\d{4}-W\d{2}$/),
  idees: z
    .array(
      z.object({
        id: z.string(),
        pilier: z.string(),
        format: z.string(),
        angle: z.string(),
        accroche: z.string(),
        revelation: z.string(),
        pourquoi_maintenant: z.string(),
        notes: z.object({
          accroche: note,
          interet: note,
          originalite: note,
          faisabilite_visuelle: note,
          verifiabilite: note,
        }),
        score: z.number(),
        hypothese: z.boolean(),
      }),
    )
    .length(20),
  series: z.array(z.object({ titre: z.string(), episodes: z.array(z.string()).min(3) })),
  ecartees: z.array(z.object({ idee: z.string(), raison: z.string() })),
});

export type Output = z.infer<typeof outputSchema>;
