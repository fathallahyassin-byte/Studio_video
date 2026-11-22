import type { GeneratedMedia } from "./media";

export type ImageGenRequest = {
  prompt: string;
  negativePrompt: string | null;
  /** toujours 9:16 pour l'instant */
  aspectRatio: "9:16";
};

export type ImageGenProvider = {
  readonly name: string;
  estimateCost(request: ImageGenRequest): number;
  generate(request: ImageGenRequest): Promise<GeneratedMedia>;
};
