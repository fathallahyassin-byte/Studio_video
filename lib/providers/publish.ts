export type PublishPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

export type PublishRequest = {
  videoUrl: string;
  caption: string;
  hashtags: string[];
  /** fixé par le rapport du contrôle qualité, jamais par l'appelant */
  aiLabel: boolean;
  brandedContent: boolean;
  title?: string;
};

/**
 * Publication sur une plateforme. Le contrôle de la Validation V3 se fait avant d'appeler
 * ce provider, dans la machine à états et dans l'API (CLAUDE.md §8).
 */
export type PublishProvider = {
  readonly platform: PublishPlatform;
  /** false tant que l'API n'est pas utilisable : on passe en publication manuelle */
  readonly ready: boolean;
  publish(request: PublishRequest): Promise<{ externalId: string }>;
};
