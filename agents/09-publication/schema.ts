import { z } from "zod";

const creneau = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const outputSchema = z.object({
  idee_id: z.string(),
  tiktok: z.object({
    legende: z.string().max(4000),
    hashtags: z.array(z.string()).min(3).max(5),
    texte_couverture: z.string(),
    commentaire_epingle: z.string(),
    etiquette_ia: z.boolean(),
    contenu_de_marque: z.boolean(),
    creneau,
  }),
  instagram: z.object({
    legende: z.string(),
    hashtags: z.array(z.string()),
    texte_couverture: z.string(),
    etiquette_ia: z.boolean(),
    partenariat: z.boolean(),
    creneau,
  }),
  youtube: z.object({
    titre: z.string().max(100),
    description: z.string(),
    hashtags: z.array(z.string()),
    commentaire_epingle: z.string(),
    contient_media_synthetique: z.boolean(),
    creneau,
  }),
  mots_cles_vises: z.array(z.string()),
});

export type Output = z.infer<typeof outputSchema>;
