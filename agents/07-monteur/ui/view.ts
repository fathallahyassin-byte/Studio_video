import type { ChipTone } from "@/components/ui";
import type { Output } from "../schema";

// Types du modèle de vue du panneau (données sérialisables, passées au composant client).

export type SegmentTone = "ink" | "soft" | "wait";

/** Un bloc sur la frise : position et largeur en % de la durée. */
export type Segment = { key: string; label: string; title: string; startS: number; endS: number; left: number; width: number; tone: SegmentTone };

export type TrackId = "video" | "texte" | "sous_titres" | "voix" | "musique";

export type TrackView = { id: TrackId; label: string; segments: Segment[]; empty: string };

export type TimelineStatus = { label: string; tone: ChipTone; notice: string | null };

export type TimelineView = {
  videoId: string;
  label: string;
  title: string;
  updatedLabel: string;
  status: TimelineStatus;
  durationS: number;
  durationLabel: string;
  exportLabel: string;
  tracks: TrackView[];
  ticks: { left: number; label: string }[];
  /** `action` : l'alerte attend l'humain (fichier à fournir), seule affichée en jaune */
  alerts: { text: string; action: boolean }[];
  /** la timeline telle quelle : inputProps du Remotion Player (même composition que le rendu) */
  timeline: Output;
  /** MP4 rendu (dernier Asset RENDER) */
  renderUrl: string | null;
  /** la vidéo attend son rendu */
  awaitingRender: boolean;
};

/** « 12,2 s » */
export function formatSeconds(value: number): string {
  return `${String(Math.round(value * 10) / 10).replace(".", ",")} s`;
}
