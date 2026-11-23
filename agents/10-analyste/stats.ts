// Calculs de l'analyste faits en code (CLAUDE.md §5) : le modèle reçoit les médianes et les écarts déjà calculés.
// Fonctions pures : aucune lecture de la base, la date de référence est passée en paramètre.

export const WINDOW_DAYS = 28;
export const MIN_AGE_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type PlatformId = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

/** Dernier relevé d'une publication : valeurs cumulées depuis la mise en ligne. */
export type StatValues = {
  date: Date;
  views: number;
  avgWatchTimeS: number;
  /** 0 à 1 */
  completionRate: number;
  shares: number;
  saves: number;
  followersGained: number;
};

/** Une publication de la fenêtre et son dernier relevé (null s'il n'y en a pas encore). */
export type PublicationSample = {
  videoId: string;
  platform: PlatformId;
  publishedAt: Date | null;
  stat: StatValues | null;
};

export type MetricKey = "views" | "completionRate" | "avgWatchTimeS" | "shares" | "saves" | "followersGained";

export type Exclusion = "moins_de_72h" | "date_inconnue" | "aucun_releve";

export const exclusionLabels: Record<Exclusion, string> = {
  moins_de_72h: "publiée il y a moins de 72 h",
  date_inconnue: "date de publication inconnue",
  aucun_releve: "aucune statistique importée",
};

export type ScoredRow = {
  sample: PublicationSample;
  ageHours: number | null;
  exclusion: Exclusion | null;
  /** écart à la médiane de la plateforme, en % arrondi ; null si la médiane vaut 0 ou si la ligne est exclue */
  gaps: Record<MetricKey, number | null>;
  /** moyenne des rapports vues / médiane et vue complète / médiane ; null si exclue */
  index: number | null;
};

export type PlatformMedian = { platform: PlatformId; publications: number; values: Record<MetricKey, number> };

export type VideoScore = { videoId: string; platforms: PlatformId[]; index: number; gapPct: number };

export function mapMetrics<T>(valueOf: (key: MetricKey) => T): Record<MetricKey, T> {
  return {
    views: valueOf("views"),
    completionRate: valueOf("completionRate"),
    avgWatchTimeS: valueOf("avgWatchTimeS"),
    shares: valueOf("shares"),
    saves: valueOf("saves"),
    followersGained: valueOf("followersGained"),
  };
}

/** Début de la fenêtre d'analyse (4 semaines avant la date de référence). */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
}

/** Date de référence de l'analyse : l'heure pleine, pour que variables et contrôles voient les mêmes vidéos. */
export function referenceTime(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export function ageInHours(publishedAt: Date, now: Date): number {
  return (now.getTime() - publishedAt.getTime()) / HOUR_MS;
}

/** Une publication n'entre dans les comparaisons qu'avec une date connue, 72 h d'ancienneté et un relevé. */
export function exclusionOf(sample: PublicationSample, now: Date): Exclusion | null {
  if (sample.publishedAt === null) return "date_inconnue";
  if (ageInHours(sample.publishedAt, now) < MIN_AGE_HOURS) return "moins_de_72h";
  if (sample.stat === null) return "aucun_releve";
  return null;
}

/** Médianes par plateforme, calculées sur les publications comparables uniquement. */
export function platformMedians(samples: readonly PublicationSample[], now: Date): PlatformMedian[] {
  const comparable = samples.filter((sample) => exclusionOf(sample, now) === null);
  const platforms = [...new Set(comparable.map((sample) => sample.platform))].sort();
  return platforms.map((platform) => {
    const stats = comparable.filter((sample) => sample.platform === platform).flatMap((sample) => (sample.stat ? [sample.stat] : []));
    return { platform, publications: stats.length, values: mapMetrics((key) => median(stats.map((stat) => stat[key])) ?? 0) };
  });
}

/** Rapport à la médiane ; null quand la médiane est nulle (aucune comparaison possible). */
export function ratioToMedian(value: number, reference: number): number | null {
  return reference > 0 ? value / reference : null;
}

export function gapPercent(ratio: number | null): number | null {
  return ratio === null ? null : Math.round((ratio - 1) * 100);
}

const EMPTY_GAPS: Record<MetricKey, number | null> = mapMetrics(() => null);

/** Chaque publication, avec son exclusion éventuelle et ses écarts à la médiane de sa plateforme. */
export function scoreRows(samples: readonly PublicationSample[], now: Date): ScoredRow[] {
  const medians = new Map(platformMedians(samples, now).map((entry) => [entry.platform, entry.values]));
  return samples.map((sample) => {
    const ageHours = sample.publishedAt === null ? null : ageInHours(sample.publishedAt, now);
    const exclusion = exclusionOf(sample, now);
    const reference = medians.get(sample.platform);
    const stat = sample.stat;
    if (exclusion !== null || !stat || !reference) return { sample, ageHours, exclusion, gaps: EMPTY_GAPS, index: null };
    const ratios = mapMetrics((key) => ratioToMedian(stat[key], reference[key]));
    return { sample, ageHours, exclusion, gaps: mapMetrics((key) => gapPercent(ratios[key])), index: rowIndex(ratios.views, ratios.completionRate) };
  });
}

/** Indice d'une publication : moyenne des rapports disponibles (vues, vue complète) ; 1 = la médiane. */
export function rowIndex(viewsRatio: number | null, completionRatio: number | null): number {
  const ratios = [viewsRatio, completionRatio].filter((ratio): ratio is number => ratio !== null);
  return ratios.length === 0 ? 1 : ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

/** Une ligne par vidéo comparable : moyenne des indices de ses plateformes, de la meilleure à la moins bonne. */
export function rankVideos(rows: readonly ScoredRow[]): VideoScore[] {
  const byVideo = new Map<string, { platforms: PlatformId[]; indices: number[] }>();
  for (const row of rows) {
    if (row.index === null) continue;
    const entry = byVideo.get(row.sample.videoId) ?? { platforms: [], indices: [] };
    byVideo.set(row.sample.videoId, { platforms: [...entry.platforms, row.sample.platform], indices: [...entry.indices, row.index] });
  }
  const scores = [...byVideo.entries()].map(([videoId, entry]): VideoScore => {
    const index = entry.indices.reduce((sum, value) => sum + value, 0) / entry.indices.length;
    return { videoId, platforms: entry.platforms, index, gapPct: Math.round((index - 1) * 100) };
  });
  return scores.sort((a, b) => b.index - a.index || a.videoId.localeCompare(b.videoId));
}

/** Taille du top et du flop : 3 chacun au plus, sans jamais compter une vidéo deux fois. */
export function expectedRanking(comparableVideos: number): { top: number; flop: number } {
  return { top: Math.min(3, Math.ceil(comparableVideos / 2)), flop: Math.min(3, Math.floor(comparableVideos / 2)) };
}
