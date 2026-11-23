import type { Platform } from "@/lib/generated/prisma/client";
import type { Output } from "./schema";

// Les trois plateformes, leur clé dans la sortie du modèle et leurs limites techniques.
// Limites relevées en novembre 2026, à revérifier avant de brancher une API (voir NEEDS.md).

export type PlatformKey = "tiktok" | "instagram" | "youtube";

export type PlatformInfo = { platform: Platform; key: PlatformKey; label: string };

export const PLATFORMS: readonly PlatformInfo[] = [
  { platform: "TIKTOK", key: "tiktok", label: "TikTok" },
  { platform: "INSTAGRAM", key: "instagram", label: "Instagram Reels" },
  { platform: "YOUTUBE", key: "youtube", label: "YouTube Shorts" },
];

export const ALL_PLATFORMS: readonly Platform[] = PLATFORMS.map((info) => info.platform);

export function platformInfo(platform: Platform): PlatformInfo {
  const info = PLATFORMS.find((entry) => entry.platform === platform);
  if (!info) throw new Error(`Plateforme inconnue : ${platform}`);
  return info;
}

export function platformLabel(platform: Platform): string {
  return platformInfo(platform).label;
}

/** Limites imposées par les plateformes (pas des choix éditoriaux) : elles s'appliquent aussi aux textes modifiés à la main. */
export const HARD_LIMITS = {
  /** TikTok : légende publiée (texte + hashtags), 2 200 caractères */
  tiktokCaption: 2200,
  /** Instagram : légende publiée (texte + hashtags), 2 200 caractères */
  instagramCaption: 2200,
  /** Instagram : 5 hashtags au plus par publication (règle annoncée fin 2025) */
  instagramHashtags: 5,
  /** YouTube Data API : titre de 100 caractères au plus, sans « < » ni « > » */
  youtubeTitle: 100,
  /** YouTube Data API : description de 5 000 octets au plus, sans « < » ni « > » */
  youtubeDescriptionBytes: 5000,
} as const;

export type PlatformTexts = {
  /** légende (TikTok, Instagram) ou description (YouTube), sans les hashtags */
  body: string;
  hashtags: string[];
  title: string | null;
};

export function textsFor(output: Output, platform: Platform): PlatformTexts {
  switch (platform) {
    case "TIKTOK":
      return { body: output.tiktok.legende, hashtags: output.tiktok.hashtags, title: null };
    case "INSTAGRAM":
      return { body: output.instagram.legende, hashtags: output.instagram.hashtags, title: null };
    case "YOUTUBE":
      return { body: output.youtube.description, hashtags: output.youtube.hashtags, title: output.youtube.titre };
  }
}

/** Texte à coller sur la plateforme : légende (ou description), puis les hashtags. */
export function composeCaption(texts: Pick<PlatformTexts, "body" | "hashtags">): string {
  const tags = texts.hashtags.join(" ");
  return tags === "" ? texts.body : `${texts.body}\n\n${tags}`;
}

export function slotOf(output: Output, platform: Platform): string {
  return output[platformInfo(platform).key].creneau;
}
