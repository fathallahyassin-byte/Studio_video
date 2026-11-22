import type { GeneratedMedia } from "./media";

export type VideoGenRequest = {
  prompt: string;
  negativePrompt: string | null;
  durationS: number;
  aspectRatio: "9:16";
  /** image de départ facultative (image animée) */
  imageUrl?: string;
};

export type VideoGenProvider = {
  readonly name: string;
  estimateCost(request: VideoGenRequest): number;
  generate(request: VideoGenRequest): Promise<GeneratedMedia>;
};
