import type { WordTiming } from "./media";

export type TtsRequest = {
  text: string;
  voiceId: string;
  /** vitesse relative, 1 = normale */
  speed?: number;
};

export type TtsResult = {
  /** URL durable (copie dans le stockage S3 : les URL des fournisseurs expirent) */
  url: string;
  /** durée réelle mesurée du fichier */
  durationS: number;
  /** horodatage mot à mot ; null si le moteur ne le fournit pas (on passe alors par Whisper) */
  words: WordTiming[] | null;
  cost: number;
};

export type TtsProvider = {
  readonly name: string;
  /** balises acceptées dans le texte, telles qu'elles s'écrivent (`<break time="0.5s"/>`, `[pause]`…), injectées dans {{BALISES_TTS}} */
  readonly supportedTags: readonly string[];
  /** le moteur renvoie l'horodatage mot à mot ; sinon il faut un Whisper, vérifié AVANT de payer la voix */
  readonly providesWordTimings: boolean;
  /** estimation dans la monnaie des budgets, sans appel payant */
  estimateCost(text: string): number;
  synthesize(request: TtsRequest): Promise<TtsResult>;
};

/**
 * Moteur de synthèse vocale configuré. Aucun n'est branché : c'est un fournisseur payant, à choisir avec
 * l'accord du propriétaire (CLAUDE.md §13), puis à créer ici d'après `.env` (TTS_API_KEY).
 */
export function getTtsProvider(): TtsProvider | null {
  return null;
}
