import type { WordTiming } from "./media";

/** Transcription (Whisper ou équivalent) : sous-titres de secours et contrôle qualité du rendu. */
export type SttProvider = {
  readonly name: string;
  /** estimation pour un audio de cette durée, dans la monnaie des budgets, sans appel payant */
  estimateCost(durationS: number): number;
  transcribe(request: { audioUrl: string; language: string }): Promise<{ text: string; words: WordTiming[]; cost: number }>;
};

/** Transcription configurée. Aucune n'est branchée : fournisseur payant, à choisir avec l'accord du propriétaire. */
export function getSttProvider(): SttProvider | null {
  return null;
}
