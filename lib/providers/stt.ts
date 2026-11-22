import type { WordTiming } from "./media";

/** Transcription (Whisper ou équivalent) : sous-titres de secours et contrôle qualité du rendu. */
export type SttProvider = {
  readonly name: string;
  transcribe(request: { audioUrl: string; language: string }): Promise<{ text: string; words: WordTiming[]; cost: number }>;
};
