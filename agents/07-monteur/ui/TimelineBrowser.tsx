"use client";

import { Player, type PlayerRef } from "@remotion/player";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { buttonClass, Chip, FormMessage, PendingNote } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { durationInFrames, FPS, HEIGHT, toFrame, WIDTH } from "@/remotion/logic";
import { Montage } from "@/remotion/Montage";
import type { RenderAvailability } from "../render";
import { launchRenderAction, type RenderFormState } from "./actions";
import { formatSeconds, type Segment, type TimelineView, type TrackView } from "./view";

// Liste des timelines à gauche ; à droite, le Remotion Player (même composition que le rendu) et la frise des pistes.
// Le jaune ne sert qu'à ce qui attend l'humain (vidéo à corriger, média manquant).

const textWrap = "[overflow-wrap:anywhere]";

export function TimelineBrowser({ timelines, render }: { timelines: TimelineView[]; render: RenderAvailability }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = timelines.find((timeline) => timeline.videoId === selectedId) ?? timelines[0] ?? null;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)]">
      <TimelineList timelines={timelines} selectedId={selected?.videoId ?? null} onSelect={setSelectedId} />
      {selected ? <TimelineDetail key={selected.videoId} timeline={selected} render={render} /> : null}
    </div>
  );
}

function TimelineList({ timelines, selectedId, onSelect }: { timelines: TimelineView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Timelines récentes" className="flex min-w-0 flex-col gap-2">
      {timelines.map((timeline) => {
        const isSelected = timeline.videoId === selectedId;
        return (
          <li key={timeline.videoId}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(timeline.videoId)}
              className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
              }`}
            >
              <span className={`text-[15px] font-bold ${textWrap}`}>
                {timeline.label} · {timeline.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone={timeline.status.tone}>{timeline.status.label}</Chip>
                <Chip tone="run">{timeline.durationLabel}</Chip>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Instant courant du Player (en secondes), mis à jour pendant la lecture et après un déplacement. */
function usePlayerTime(playerRef: React.RefObject<PlayerRef | null>): number {
  const [timeS, setTimeS] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => setTimeS(event.detail.frame / FPS);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
    };
  }, [playerRef]);
  return timeS;
}

function TimelineDetail({ timeline, render }: { timeline: TimelineView; render: RenderAvailability }) {
  const titleId = useId();
  const playerRef = useRef<PlayerRef>(null);
  const timeS = usePlayerTime(playerRef);
  const seek = (seconds: number) => playerRef.current?.seekTo(toFrame(seconds));
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[13px] font-bold text-muted ${textWrap}`}>
            {timeline.label} · mis à jour {timeline.updatedLabel} · {timeline.exportLabel}
          </p>
          <h3 id={titleId} className={`font-display mt-1 text-[28px] ${textWrap}`}>
            {timeline.title}
          </h3>
        </div>
        <Chip tone={timeline.status.tone}>{timeline.status.label}</Chip>
      </header>

      {timeline.status.notice ? <AwaitingNotice videoId={timeline.videoId} notice={timeline.status.notice} /> : null}
      <Alerts alerts={timeline.alerts} />

      <div className="grid gap-5 md:grid-cols-[minmax(180px,260px)_minmax(0,1fr)]">
        <figure className="flex w-full max-w-[260px] flex-col gap-2 justify-self-center md:justify-self-start">
          <div className="overflow-hidden rounded-xl bg-ink">
            <Player
              ref={playerRef}
              component={Montage}
              inputProps={timeline.timeline}
              durationInFrames={durationInFrames(timeline.timeline)}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              fps={FPS}
              controls
              acknowledgeRemotionLicense
              style={{ width: "100%", aspectRatio: `${WIDTH} / ${HEIGHT}` }}
            />
          </div>
          <figcaption className="text-[13px] text-muted">
            Prévisualisation de la timeline (même composition que le rendu).
            {timeline.renderUrl ? (
              <>
                {" "}
                <a href={timeline.renderUrl} className="font-bold text-ink underline underline-offset-2">
                  Ouvrir le MP4 rendu
                </a>
              </>
            ) : null}
          </figcaption>
        </figure>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-[13px] font-bold tabular-nums text-ink" aria-live="off">
            {formatSeconds(timeS)} / {timeline.durationLabel}
          </p>
          <Tracks timeline={timeline} timeS={timeS} onSeek={seek} />
        </div>
      </div>

      <RenderForm videoId={timeline.videoId} awaitingRender={timeline.awaitingRender} render={render} />
    </article>
  );
}

function AwaitingNotice({ videoId, notice }: { videoId: string; notice: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
      <p className={`font-bold ${textWrap}`}>{notice}</p>
      <Link href={`/validations?item=${videoId}`} className={`${buttonClass("ink")} self-start`}>
        Ouvrir dans Validations
      </Link>
    </div>
  );
}

function Alerts({ alerts }: { alerts: TimelineView["alerts"] }) {
  if (alerts.length === 0) return <p className="text-[14px] text-muted">Aucune alerte.</p>;
  return (
    <section aria-label="Alertes" className="flex flex-col gap-1.5">
      <h4 className="text-[15px] font-[750] text-ink">Alertes</h4>
      <ul className="flex flex-col gap-1.5">
        {alerts.map((alert) => (
          <li key={alert.text} className={`rounded-xl px-3 py-2 text-[14px] ${textWrap} ${alert.action ? "bg-wait font-bold text-ink" : "bg-paper text-text"}`}>
            {alert.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tracks({ timeline, timeS, onSeek }: { timeline: TimelineView; timeS: number; onSeek: (seconds: number) => void }) {
  const playhead = timeline.durationS > 0 ? Math.min((timeS / timeline.durationS) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div aria-hidden="true" className="relative h-4 text-[11px] text-muted sm:ml-[112px]">
        {timeline.ticks.map((tick) => (
          <span key={tick.label} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: `${tick.left}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      {timeline.tracks.map((track) => (
        <TrackRow key={track.id} track={track} playhead={playhead} onSeek={onSeek} />
      ))}
    </div>
  );
}

const segmentTones: Record<Segment["tone"], string> = {
  ink: "bg-ink text-white",
  soft: "bg-[#DCDDD8] text-ink",
  wait: "bg-wait text-ink",
};

function TrackRow({ track, playhead, onSeek }: { track: TrackView; playhead: number; onSeek: (seconds: number) => void }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-[13px] font-bold text-ink sm:w-[100px] sm:shrink-0">{track.label}</span>
      <div className="relative h-9 min-w-0 flex-1 overflow-hidden rounded-lg bg-paper shadow-[inset_0_0_0_1px_var(--color-line)]">
        {track.segments.length === 0 ? <span className="absolute inset-0 flex items-center px-2 text-[12px] text-muted">{track.empty}</span> : null}
        {track.segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            title={segment.title}
            aria-label={`${track.label} : ${segment.title}, aller à cet instant`}
            onClick={() => onSeek(segment.startS)}
            className={`absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-left text-[11px] font-bold text-ellipsis whitespace-nowrap focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${segmentTones[segment.tone]}`}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
          >
            {segment.label}
          </button>
        ))}
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${playhead}%` }} />
      </div>
    </div>
  );
}

function RenderForm({ videoId, awaitingRender, render }: { videoId: string; awaitingRender: boolean; render: RenderAvailability }) {
  const { state, pending, onSubmit } = useKeptForm<RenderFormState>(launchRenderAction, null);
  const ready = render.enabled && awaitingRender;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-line pt-4">
      <input type="hidden" name="videoId" value={videoId} />
      <button type="submit" disabled={!ready || pending} className={`${buttonClass("ink")} self-start`}>
        {pending ? "Envoi…" : "Lancer le rendu"}
      </button>
      {render.note ? <PendingNote>{render.note}</PendingNote> : null}
      {render.enabled && !awaitingRender ? <PendingNote>La vidéo n&apos;attend pas de rendu à cette étape.</PendingNote> : null}
      <FormMessage state={state} />
    </form>
  );
}
