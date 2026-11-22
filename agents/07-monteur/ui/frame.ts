import type { ChipTone } from "@/components/ui";

// Types du modèle de vue et image à un instant donné (prévisualisation statique, en attendant le Remotion Player).
// Fonctions pures, sans dépendance serveur : importées par le composant client.

export type SegmentTone = "ink" | "soft" | "wait";

/** Un bloc sur la frise : position et largeur en % de la durée. */
export type Segment = { key: string; label: string; title: string; startS: number; endS: number; left: number; width: number; tone: SegmentTone };

export type TrackId = "video" | "texte" | "sous_titres" | "voix" | "musique";

export type TrackView = { id: TrackId; label: string; segments: Segment[]; empty: string };

export type ClipView = { plan: string; startS: number; endS: number; src: string; kind: "IMAGE" | "VIDEO" | "TEXT" | "MISSING"; movement: string; transition: string };

export type TextView = { text: string; startS: number; endS: number; position: string; animation: string };

/** Mot actif repéré dans le groupe : avant, mot, après. */
export type CueView = { startS: number; endS: number; before: string; active: string; after: string };

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
  clips: ClipView[];
  texts: TextView[];
  cues: CueView[];
  /** la vidéo attend son rendu */
  awaitingRender: boolean;
};

export type FrameView = { timeS: number; clip: ClipView | null; texts: TextView[]; cue: CueView | null };

function isActive(span: { startS: number; endS: number }, timeS: number, durationS: number): boolean {
  return span.startS <= timeS && (timeS < span.endS || (timeS === durationS && span.endS === durationS));
}

/** Ce que montre l'image à l'instant `timeS` : plan, textes à l'écran et sous-titre. */
export function frameAt(view: Pick<TimelineView, "clips" | "texts" | "cues" | "durationS">, timeS: number): FrameView {
  const time = Math.min(Math.max(timeS, 0), view.durationS);
  return {
    timeS: time,
    clip: view.clips.find((clip) => isActive(clip, time, view.durationS)) ?? null,
    texts: view.texts.filter((text) => isActive(text, time, view.durationS)),
    cue: view.cues.find((cue) => isActive(cue, time, view.durationS)) ?? null,
  };
}

/** « 12,2 s » */
export function formatSeconds(value: number): string {
  return `${String(Math.round(value * 10) / 10).replace(".", ",")} s`;
}
