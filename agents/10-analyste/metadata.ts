import { z } from "zod";
import { median, type PlatformId, type ScoredRow, type VideoScore } from "./stats";

// Métadonnées d'une vidéo (pilier, format, accroche, durée, visuel, créneau, versions de prompt), lues dans
// les JSON des agents 2, 4, 5 et 7. Lecture tolérante : une vidéo ajoutée à la main n'a ni pilier ni format.

/** Ce que la base fournit pour une vidéo de la fenêtre. */
export type VideoRecord = {
  id: string;
  number: number;
  title: string;
  idea: unknown;
  script: unknown;
  storyboard: unknown;
  timeline: unknown;
  publications: { platform: PlatformId; publishedAt: Date | null }[];
  /** version de prompt de la dernière exécution réussie de chaque agent sur la vidéo */
  promptVersions: { agentId: number; version: number }[];
};

export type VideoMeta = {
  videoId: string;
  label: string;
  title: string;
  pillar: string | null;
  format: string | null;
  hookType: string | null;
  hookText: string | null;
  durationS: number | null;
  visual: string | null;
  slots: { platform: PlatformId; label: string | null }[];
  promptVersions: { agentId: number; version: number }[];
};

const ideaSchema = z.looseObject({ pilier: z.string().optional(), format: z.string().optional(), accroche: z.string().optional() });
const scriptSchema = z.looseObject({
  accroches: z.array(z.looseObject({ type: z.string(), voix: z.string().optional() })).optional(),
  duree_estimee_s: z.number().optional(),
});
const storyboardSchema = z.looseObject({ plans: z.array(z.looseObject({ type: z.string() })) });
const timelineSchema = z.looseObject({ duree_totale_s: z.number() });

const weekdayHour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", hour: "numeric" });

/** « lundi 18 h » (heure locale du serveur, comme le planning du worker). */
export function slotLabel(date: Date): string {
  const parts = weekdayHour.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  return `${weekday} ${Number(hour)} h`;
}

/** Tranche de 15 s : « 60–75 s ». */
export function durationBucket(durationS: number): string {
  const start = Math.floor(durationS / 15) * 15;
  return `${start}–${start + 15} s`;
}

/** Type de plan le plus fréquent du storyboard (image_ia_animee, stock…). */
export function dominantVisual(storyboard: unknown): string | null {
  const parsed = storyboardSchema.safeParse(storyboard);
  if (!parsed.success || parsed.data.plans.length === 0) return null;
  const counts = new Map<string, number>();
  for (const plan of parsed.data.plans) counts.set(plan.type, (counts.get(plan.type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export function formatVideoLabel(number: number): string {
  return `V-${String(number).padStart(3, "0")}`;
}

export function readVideoMeta(record: VideoRecord): VideoMeta {
  const idea = ideaSchema.safeParse(record.idea);
  const script = scriptSchema.safeParse(record.script);
  const timeline = timelineSchema.safeParse(record.timeline);
  const hook = script.success ? script.data.accroches?.[0] : undefined;
  return {
    videoId: record.id,
    label: formatVideoLabel(record.number),
    title: record.title,
    pillar: idea.success ? (idea.data.pilier ?? null) : null,
    format: idea.success ? (idea.data.format ?? null) : null,
    hookType: hook?.type ?? null,
    hookText: hook?.voix ?? (idea.success ? (idea.data.accroche ?? null) : null),
    durationS: timeline.success ? timeline.data.duree_totale_s : script.success ? (script.data.duree_estimee_s ?? null) : null,
    visual: dominantVisual(record.storyboard),
    slots: record.publications.map((publication) => ({ platform: publication.platform, label: publication.publishedAt ? slotLabel(publication.publishedAt) : null })),
    promptVersions: [...record.promptVersions].sort((a, b) => a.agentId - b.agentId),
  };
}

export type GroupDimension = "pilier" | "format" | "type_accroche" | "tranche_duree" | "visuel" | "creneau";

/** `count` : nombre de vidéos, ou de publications pour le créneau. */
export type GroupStat = { dimension: GroupDimension; value: string; count: number; medianIndex: number; gapPct: number };

const VIDEO_DIMENSIONS: readonly (readonly [GroupDimension, (meta: VideoMeta) => string | null])[] = [
  ["pilier", (meta) => meta.pillar],
  ["format", (meta) => meta.format],
  ["type_accroche", (meta) => meta.hookType],
  ["tranche_duree", (meta) => (meta.durationS === null ? null : durationBucket(meta.durationS))],
  ["visuel", (meta) => meta.visual],
];

/**
 * Regroupements précalculés (indice médian par pilier, format, accroche…) : le modèle compare des groupes
 * sans faire lui-même de moyenne. Le créneau se regroupe par publication, le reste par vidéo.
 */
export function buildGroups(scores: readonly VideoScore[], rows: readonly ScoredRow[], metas: readonly VideoMeta[]): GroupStat[] {
  const metaById = new Map(metas.map((meta) => [meta.videoId, meta]));
  const groups: GroupStat[] = [];
  for (const [dimension, valueOf] of VIDEO_DIMENSIONS) {
    const values = scores.map((score) => ({ value: valueOfMeta(metaById.get(score.videoId), valueOf), index: score.index }));
    groups.push(...summarize(dimension, values));
  }
  const slotValues = rows.map((row) => ({ value: slotOf(row, metaById.get(row.sample.videoId)), index: row.index }));
  groups.push(...summarize("creneau", slotValues));
  return groups;
}

function valueOfMeta(meta: VideoMeta | undefined, valueOf: (meta: VideoMeta) => string | null): string | null {
  return meta ? valueOf(meta) : null;
}

function slotOf(row: ScoredRow, meta: VideoMeta | undefined): string | null {
  return meta?.slots.find((slot) => slot.platform === row.sample.platform)?.label ?? null;
}

function summarize(dimension: GroupDimension, values: readonly { value: string | null; index: number | null }[]): GroupStat[] {
  const byValue = new Map<string, number[]>();
  for (const entry of values) {
    if (entry.value === null || entry.index === null) continue;
    byValue.set(entry.value, [...(byValue.get(entry.value) ?? []), entry.index]);
  }
  return [...byValue.entries()]
    .map(([value, indices]) => {
      const medianIndex = median(indices) ?? 1;
      return { dimension, value, count: indices.length, medianIndex, gapPct: Math.round((medianIndex - 1) * 100) };
    })
    .sort((a, b) => b.medianIndex - a.medianIndex || a.value.localeCompare(b.value));
}
