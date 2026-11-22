import type { Platform } from "@/lib/generated/prisma/client";
import { outputSchema, type Output } from "./schema";

// Étiquettes du rapport, dans la forme des colonnes de Publication (aiLabel, brandedContent).
// À utiliser par l'agent 9 et le module de publication pour les copier sans les réinterpréter (voir NEEDS.md).

export type PublicationLabels = { aiLabel: boolean; brandedContent: boolean };

export function toPublicationLabels(etiquettes: Output["etiquettes"]): Record<Platform, PublicationLabels> {
  const brandedContent = etiquettes.contenu_de_marque;
  return {
    TIKTOK: { aiLabel: etiquettes.tiktok_contenu_ia, brandedContent },
    INSTAGRAM: { aiLabel: etiquettes.instagram_contenu_ia, brandedContent },
    YOUTUBE: { aiLabel: etiquettes.youtube_utilisation_ia, brandedContent },
  };
}

/** Étiquettes lues dans Video.qaJson ; null si le rapport manque ou est illisible (alors : pas de publication). */
export function readPublicationLabels(qaJson: unknown): Record<Platform, PublicationLabels> | null {
  const parsed = outputSchema.safeParse(qaJson);
  return parsed.success ? toPublicationLabels(parsed.data.etiquettes) : null;
}
