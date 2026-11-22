import { z } from "zod";

export const outputSchema = z.object({
  video_id: z.string(),
  etape_actuelle: z.string(),
  statut: z.enum(["en_cours", "attente_validation", "bloque", "publie"]),
  prochaine_action: z.object({
    agent: z.string(),
    consigne: z.string(),
    entrees: z.record(z.string(), z.unknown()),
  }),
  controle_dernier_livrable: z.object({
    agent: z.string(),
    conforme: z.boolean(),
    problemes: z.array(z.string()),
  }),
  question_humain: z.string().nullable(),
  journal: z.array(z.string()),
});

export type Output = z.infer<typeof outputSchema>;
