import type { Output } from "./schema";
import type { TrackJson } from "./audioPlan";

// Choix de la musique. Aucune banque de musique n'existe dans lib/providers : l'interface est déclarée ici
// (à déplacer dans lib/providers/music.ts, voir NEEDS.md). Règle : jamais de piste ni d'Asset MUSIC sans licence.

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

/** Pistes enregistrées en Asset MUSIC (choix de l'humain ou de la banque). */
export type MusicStore = {
  /** dernière piste choisie par l'humain dans le panneau pour cette vidéo ; null s'il n'y en a pas */
  findManualChoice(videoId: string): Promise<TrackJson | null>;
  /** Asset MUSIC (sans doublon pour une même URL) et coût ajouté à la vidéo ; refusé sans licence */
  recordTrack(videoId: string, track: TrackJson, cost: number): Promise<void>;
};

export class MissingLicenseError extends Error {
  constructor(title: string) {
    super(`Piste « ${title} » sans licence : elle n'est ni enregistrée ni utilisée.`);
    this.name = "MissingLicenseError";
  }
}

export function hasLicense(license: string | null | undefined): license is string {
  return typeof license === "string" && license.trim() !== "";
}

/** Garde-fou avant tout enregistrement d'Asset MUSIC (la base a aussi une contrainte CHECK). */
export function assertLicensed(track: Pick<TrackJson, "titre" | "licence">): void {
  if (!hasLicense(track.licence)) throw new MissingLicenseError(track.titre);
}

export function musicQuery(brief: Output["musique"], minDurationS: number): MusicQuery {
  return { keywords: brief.mots_cles_recherche, mood: brief.ambiance, instruments: brief.instruments, bpm: brief.bpm, minDurationS };
}

export type TrackChoice = { status: "chosen"; track: MusicTrack } | { status: "none"; unlicensed: number; total: number };

/** Pistes sous licence commerciale, assez longues ; la plus proche du tempo demandé l'emporte. */
export function chooseTrack(tracks: readonly MusicTrack[], query: Pick<MusicQuery, "bpm" | "minDurationS">): TrackChoice {
  const licensed = tracks.filter((track) => hasLicense(track.license) && track.commercialUse);
  const usable = licensed.filter((track) => track.durationS === null || track.durationS >= query.minDurationS);
  const gap = (track: MusicTrack) => (track.bpm === null ? Number.POSITIVE_INFINITY : Math.abs(track.bpm - query.bpm));
  const best = [...usable].sort((a, b) => gap(a) - gap(b))[0];
  return best ? { status: "chosen", track: best } : { status: "none", unlicensed: tracks.length - licensed.length, total: tracks.length };
}

export function toTrackJson(track: MusicTrack, library: string): TrackJson {
  return { titre: track.title, url: track.url, fournisseur: library, licence: (track.license ?? "").trim(), source: "banque" };
}

export type MusicResolution =
  | { status: "manual"; track: TrackJson }
  | { status: "library"; track: TrackJson; cost: number }
  | { status: "missing"; reason: string };

export const NO_LIBRARY =
  "aucune banque de musique n'est branchée : choisis une piste sous licence commerciale dans le panneau Voix et son, puis relance l'étape.";

/** Le choix de l'humain d'abord, puis la banque. Rien n'est enregistré ici. */
export async function resolveMusic(store: MusicStore, library: MusicLibrary | null, input: { videoId: string; brief: Output["musique"]; minDurationS: number }): Promise<MusicResolution> {
  const manual = await store.findManualChoice(input.videoId);
  if (manual && hasLicense(manual.licence)) return { status: "manual", track: manual };
  if (!library) return { status: "missing", reason: NO_LIBRARY };
  const choice = chooseTrack(await library.search(musicQuery(input.brief, input.minDurationS)), { bpm: input.brief.bpm, minDurationS: input.minDurationS });
  if (choice.status === "chosen") return { status: "library", track: toTrackJson(choice.track, library.name), cost: choice.track.cost };
  const refused = choice.unlicensed > 0 ? ` (${choice.unlicensed} piste(s) sans licence commerciale écartée(s))` : "";
  return { status: "missing", reason: `aucune piste sous licence commerciale trouvée dans ${library.name} pour « ${input.brief.mots_cles_recherche.join(", ")} »${refused}. Choisis-en une dans le panneau, puis relance l'étape.` };
}
