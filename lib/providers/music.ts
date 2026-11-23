// Banque de musique libre de droits : recherche de pistes pour le plan sonore (agent 6).
// Une piste sans licence est toujours écartée (CLAUDE.md §8).

export type MusicTrack = {
  id: string;
  title: string;
  url: string;
  /** texte de la licence ; null ou vide = piste refusée */
  license: string | null;
  /** la licence couvre l'usage commercial sur TikTok, Instagram et YouTube */
  commercialUse: boolean;
  durationS: number | null;
  bpm: number | null;
  /** coût dans la monnaie des budgets (0 pour une bibliothèque libre de droits) */
  cost: number;
};

export type MusicQuery = { keywords: string[]; mood: string; instruments: string[]; bpm: number; minDurationS: number };

export type MusicLibrary = {
  readonly name: string;
  search(query: MusicQuery): Promise<MusicTrack[]>;
};

/** Banque configurée. Aucune n'est branchée : en attendant, l'humain choisit la piste dans le panneau Voix et son. */
export function getMusicLibrary(): MusicLibrary | null {
  return null;
}
