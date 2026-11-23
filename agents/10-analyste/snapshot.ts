import { isoWeek } from "@/lib/pipeline/service";
import { buildGroups, readVideoMeta, type GroupStat, type VideoMeta, type VideoRecord } from "./metadata";
import {
  expectedRanking,
  platformMedians,
  rankVideos,
  scoreRows,
  windowStart,
  type PlatformMedian,
  type PublicationSample,
  type ScoredRow,
  type VideoScore,
} from "./stats";

// Tout ce que l'analyste sait de la période, calculé une fois à partir des données de la base.
// Relu à l'identique par buildVariables, normalize et controls (même date de référence).

export type AnalysisInput = { now: Date; samples: readonly PublicationSample[]; videos: readonly VideoRecord[] };

export type AnalysisSnapshot = {
  now: Date;
  since: Date;
  /** semaine ISO de l'analyse, ex. « 2026-W48 » */
  period: string;
  rows: ScoredRow[];
  medians: PlatformMedian[];
  /** vidéos comparables (au moins 72 h et un relevé), de la meilleure à la moins bonne */
  ranking: VideoScore[];
  metas: VideoMeta[];
  groups: GroupStat[];
  expected: { top: number; flop: number };
  /** pourcentages présents dans les données : les seuls que le modèle peut citer */
  allowedPercents: number[];
};

export function buildSnapshot(input: AnalysisInput): AnalysisSnapshot {
  const rows = scoreRows(input.samples, input.now);
  const medians = platformMedians(input.samples, input.now);
  const ranking = rankVideos(rows);
  const metas = input.videos.map(readVideoMeta);
  const groups = buildGroups(ranking, rows, metas);
  return {
    now: input.now,
    since: windowStart(input.now),
    period: analysisPeriod(input.now),
    rows,
    medians,
    ranking,
    metas,
    groups,
    expected: expectedRanking(ranking.length),
    allowedPercents: collectPercents(rows, medians, ranking, groups),
  };
}

/** Semaine ISO de l'analyse, comme la clé de la tâche du lundi (« 2026-W48 »). */
export function analysisPeriod(now: Date): string {
  return isoWeek(now);
}

/** Sans vidéo comparable, il n'y a rien à analyser : le modèle n'est pas appelé. */
export function hasComparableVideos(snapshot: AnalysisSnapshot): boolean {
  return snapshot.ranking.length > 0;
}

export function toPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

function collectPercents(rows: readonly ScoredRow[], medians: readonly PlatformMedian[], ranking: readonly VideoScore[], groups: readonly GroupStat[]): number[] {
  const values = [
    ...rows.flatMap((row) => (row.sample.stat ? [toPercent(row.sample.stat.completionRate)] : [])),
    ...rows.flatMap((row) => Object.values(row.gaps).filter((gap): gap is number => gap !== null)),
    ...medians.map((entry) => toPercent(entry.values.completionRate)),
    ...ranking.map((score) => score.gapPct),
    ...groups.map((group) => group.gapPct),
  ];
  return [...new Set(values.map(Math.abs))].sort((a, b) => a - b);
}
