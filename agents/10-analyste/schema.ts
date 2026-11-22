import { z } from "zod";

export const outputSchema = z.object({
  periode: z.string(),
  resume: z.string(),
  top: z.array(z.object({ video_id: z.string(), pourquoi: z.string() })),
  flop: z.array(z.object({ video_id: z.string(), pourquoi: z.string() })),
  enseignements: z
    .array(
      z.object({
        observation: z.string(),
        nb_videos: z.number().int().nonnegative(),
        confiance: z.enum(["faible", "moyenne", "forte"]),
        decision: z.string(),
      }),
    )
    .min(1)
    .max(5),
  experiences: z
    .array(z.object({ hypothese: z.string(), variable: z.string(), critere_reussite: z.string() }))
    .max(2),
  maj_bible: z.array(z.string()),
  maj_backlog: z.object({
    prioriser: z.array(z.string()),
    abandonner: z.array(z.string()),
    series: z.array(z.string()),
  }),
  verdict_niche: z.enum(["continuer", "ajuster", "pivoter"]),
  justification: z.string(),
});

export type Output = z.infer<typeof outputSchema>;
