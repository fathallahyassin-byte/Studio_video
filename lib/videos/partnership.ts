import type { PrismaClient } from "@/lib/generated/prisma/client";

// Partenariat commercial d'une vidéo (Video.partnership), saisi en V2 et lu par le contrôle qualité (agent 8).

export const NO_PARTNERSHIP = "aucun";
export const MAX_PARTNERSHIP_LENGTH = 300;

const NONE_WORDS = new Set(["", "aucun", "aucune", "non", "néant", "neant", "-"]);

/** Texte enregistré : « aucun » pour un champ vide ou équivalent, sinon la marque et la contrepartie saisies. */
export function normalizePartnership(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return NONE_WORDS.has(trimmed.toLowerCase()) ? NO_PARTNERSHIP : trimmed;
}

/** Enregistre le partenariat saisi (avant la production : le contrôle qualité le lit dans {{PARTENARIAT}}). */
export async function savePartnership(db: Pick<PrismaClient, "video">, videoId: string, text: string): Promise<void> {
  await db.video.update({ where: { id: videoId }, data: { partnership: normalizePartnership(text) } });
}
