import type { WordTiming } from "./media";

export type TtsRequest = {
  text: string;
  voiceId: string;
  /** vitesse relative, 1 = normale */
  speed?: number;
};

export type TtsResult = {
  url: string;
  durationS: number;
  /** horodatage mot à mot ; null si le moteur ne le fournit pas (on passe alors par Whisper) */
  words: WordTiming[] | null;
  cost: number;
};

export type TtsProvider = {
  readonly name: string;
  /** balises acceptées dans le texte, injectées dans {{BALISES_TTS}} */
  readonly supportedTags: readonly string[];
  estimateCost(text: string): number;
  synthesize(request: TtsRequest): Promise<TtsResult>;
};
