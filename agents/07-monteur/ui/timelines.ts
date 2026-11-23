import type { Stage } from "@/lib/generated/prisma/client";
import type { EditAsset, EditVideo } from "../ports";
import type { Output } from "../schema";
import { blockingIssues, inspectSources, missingMedia, parseStoredTimeline } from "../sources";
import { formatSeconds, type Segment, type SegmentTone, type TimelineStatus, type TimelineView, type TrackView } from "./view";

// Modèle de vue du panneau : données sérialisables, calculées côté serveur (fonctions pures).

export type TimelineRow = {
  id: string;
  label: string;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  blockedReason: string | null;
  updatedLabel: string;
  timelineJson: unknown;
};

type Span = { debut_s: number; fin_s: number };

const BLOCKING_STAGES: readonly Stage[] = ["EDIT", "RENDER"];

export function toStatus(row: Pick<TimelineRow, "stage" | "blockedAt" | "blockedReason">): TimelineStatus {
  if (row.stage === "NEEDS_FIX" && row.blockedAt !== null && BLOCKING_STAGES.includes(row.blockedAt)) {
    return { label: "À corriger", tone: "wait", notice: row.blockedReason ?? "Vidéo bloquée au montage." };
  }
  if (row.stage === "EDIT") return { label: "Montage en cours", tone: "run", notice: null };
  if (row.stage === "RENDER") return { label: "Rendu en attente", tone: "run", notice: null };
  if (row.stage === "REJECTED") return { label: "Écartée", tone: "run", notice: null };
  return { label: "Rendu fait", tone: "ok", notice: null };
}

function percent(value: number, durationS: number): number {
  return durationS <= 0 ? 0 : Math.min(Math.max((value / durationS) * 100, 0), 100);
}

function segment(key: string, label: string, span: { startS: number; endS: number }, durationS: number, tone: SegmentTone): Segment {
  const left = percent(span.startS, durationS);
  return {
    key,
    label,
    title: `${label} · ${formatSeconds(span.startS)} → ${formatSeconds(span.endS)}`,
    startS: span.startS,
    endS: span.endS,
    left,
    width: Math.max(percent(span.endS, durationS) - left, 0.5),
    tone,
  };
}

const startEnd = (span: Span) => ({ startS: span.debut_s, endS: span.fin_s });

// ---------------------------------------------------------------------------
// Pistes.
// ---------------------------------------------------------------------------

/** Un bloc par groupe de sous-titres (les entrées par mot d'un même groupe sont fusionnées). */
function subtitleSegments(cues: Output["pistes"]["sous_titres"], durationS: number): Segment[] {
  const groups: { text: string; startS: number; endS: number }[] = [];
  for (const cue of cues) {
    const last = groups.at(-1);
    if (last && last.text === cue.mots && Math.abs(last.endS - cue.debut_s) < 0.001) last.endS = cue.fin_s;
    else groups.push({ text: cue.mots, ...startEnd(cue) });
  }
  return groups.map((group, index) => segment(`st-${index}`, group.text, group, durationS, "soft"));
}

function audioSegments(timeline: Output, type: "voix" | "musique" | "effet", durationS: number): Segment[] {
  return timeline.pistes.audio
    .filter((clip) => clip.type === type)
    .map((clip, index) => {
      const label = type === "voix" ? "Voix" : type === "musique" ? `Musique · ${clip.volume_db} dB${clip.ducking ? " · ducking" : ""}` : "Effet";
      return segment(`${type}-${index}`, label, { startS: clip.debut_s, endS: type === "effet" ? Math.min(clip.debut_s + 0.5, durationS) : durationS }, durationS, "soft");
    });
}

export function toTracks(timeline: Output): TrackView[] {
  const durationS = timeline.duree_totale_s;
  const { video, texte, sous_titres: cues } = timeline.pistes;
  return [
    {
      id: "video",
      label: "Vidéo",
      empty: "Aucun plan.",
      segments: video.map((clip, index) => segment(`v-${index}`, clip.manquant ? `${clip.plan} · manquant` : clip.plan, startEnd(clip), durationS, clip.manquant ? "wait" : "ink")),
    },
    { id: "texte", label: "Texte", empty: "Aucun texte à l'écran.", segments: texte.map((text, index) => segment(`t-${index}`, text.texte, startEnd(text), durationS, "soft")) },
    { id: "sous_titres", label: "Sous-titres", empty: "Aucun sous-titre.", segments: subtitleSegments(cues, durationS) },
    { id: "voix", label: "Voix", empty: "Aucune voix.", segments: audioSegments(timeline, "voix", durationS) },
    { id: "musique", label: "Musique et effets", empty: "Ni musique ni effet.", segments: [...audioSegments(timeline, "musique", durationS), ...audioSegments(timeline, "effet", durationS)] },
  ];
}

export function toTicks(durationS: number): { left: number; label: string }[] {
  const step = durationS > 60 ? 10 : 5;
  const ticks: { left: number; label: string }[] = [];
  for (let at = 0; at <= durationS + 0.001; at += step) ticks.push({ left: percent(at, durationS), label: `${at} s` });
  return ticks;
}

/** null si la timeline enregistrée est illisible (elle est alors comptée à part). */
export function toTimelineView(row: TimelineRow, renderUrl: string | null = null): TimelineView | null {
  const timeline = parseStoredTimeline(row.timelineJson);
  if (!timeline) return null;
  const { export: format } = timeline;
  return {
    videoId: row.id,
    label: row.label,
    title: row.title,
    updatedLabel: row.updatedLabel,
    status: toStatus(row),
    durationS: timeline.duree_totale_s,
    durationLabel: formatSeconds(timeline.duree_totale_s),
    exportLabel: `${format.largeur}×${format.hauteur} · ${format.fps} i/s · ${format.codec.toUpperCase()} · AAC 48 kHz`,
    tracks: toTracks(timeline),
    ticks: toTicks(timeline.duree_totale_s),
    alerts: timeline.alertes.map((text) => ({ text, action: /manquant/iu.test(text) })),
    timeline,
    renderUrl,
    awaitingRender: row.stage === "RENDER",
  };
}

// ---------------------------------------------------------------------------
// Montages pas encore faits : ce qui manque pour lancer le monteur.
// ---------------------------------------------------------------------------

export type PendingEditView = { videoId: string; label: string; title: string; issues: string[]; waiting: boolean; /** bloquée au montage : elle est dans la file « À valider » */ blocked: boolean };

export function toPendingEdit(row: Pick<TimelineRow, "id" | "label" | "title"> & { video: EditVideo }, assets: readonly EditAsset[]): PendingEditView {
  const sources = inspectSources(row.video, assets);
  const missing = sources.storyboard.status === "ok" ? missingMedia(sources.storyboard.value.plans, sources.media).map((plan) => plan.id) : [];
  const issues = [...blockingIssues(sources), ...(missing.length > 0 ? [`Média manquant pour ${missing.join(", ")}.`] : [])];
  return { videoId: row.id, label: row.label, title: row.title, issues, waiting: issues.length > 0 || row.video.stage === "NEEDS_FIX", blocked: row.video.stage === "NEEDS_FIX" };
}
