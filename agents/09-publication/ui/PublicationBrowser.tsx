"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Chip } from "@/components/ui";
import { CopyCaptionButton, MarkPublishedForm, PlatformTextsForm } from "./Forms";
import type { PlatformCardView, VideoView } from "./overview";

// Vidéos programmées à gauche, détail à droite. Le jaune ne sert qu'à ce que l'humain doit faire maintenant.

const textWrap = "[overflow-wrap:anywhere]";

export function PublicationBrowser({ videos }: { videos: VideoView[] }) {
  // ?video= (lien de notification, case du calendrier) l'emporte jusqu'au prochain clic dans la liste.
  const requested = useSearchParams().get("video");
  const [choice, setChoice] = useState<{ id: string; forRequest: string | null } | null>(null);
  const activeId = choice && choice.forRequest === requested ? choice.id : requested;
  const selected = videos.find((video) => video.videoId === activeId) ?? videos[0] ?? null;
  const setSelectedId = (id: string) => setChoice({ id, forRequest: requested });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
      <ul aria-label="Vidéos programmées ou publiées" className="flex min-w-0 flex-col gap-2">
        {videos.map((video) => {
          const isSelected = video.videoId === selected?.videoId;
          return (
            <li key={video.videoId}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(video.videoId)}
                className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                  isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
                }`}
              >
                <span className={`text-[15px] font-bold ${textWrap}`}>
                  {video.label} · {video.title}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Chip tone={video.status.tone}>{video.status.label}</Chip>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? <VideoDetail key={selected.videoId} video={selected} /> : null}
    </div>
  );
}

function VideoDetail({ video }: { video: VideoView }) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-muted">
            {video.label} · {video.stageLabel}
          </p>
          <h3 id={titleId} className={`font-display mt-1 text-[28px] ${textWrap}`}>
            {video.title}
          </h3>
        </div>
        <Chip tone={video.status.tone}>{video.status.label}</Chip>
      </header>
      <RenderLink url={video.renderUrl} />
      {!video.hasV3Approval ? <p className="rounded-xl bg-paper px-4 py-3 text-sm font-semibold text-ink">Pas de validation V3 approuvée : aucune publication possible.</p> : null}
      {!video.textsReady ? <p className="text-muted">Textes en préparation : l&apos;agent rédige les légendes après le GO final.</p> : null}
      {video.cards.map((card) => (
        <PlatformCard key={card.platform} videoId={video.videoId} card={card} hasRender={video.renderUrl !== null} />
      ))}
    </article>
  );
}

function RenderLink({ url }: { url: string | null }) {
  if (!url) return <p className="text-sm text-muted">Pas encore de MP4 rendu pour cette vidéo.</p>;
  return (
    <p>
      <a href={url} download className="font-bold text-ink underline underline-offset-4">
        Télécharger le MP4 (1080×1920)
      </a>
    </p>
  );
}

function LabelLine({ name, value }: { name: string; value: boolean | null }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-bold text-ink">{name} :</span>
      <span>{value === null ? "inconnu (rapport illisible)" : value ? "oui" : "non"}</span>
    </li>
  );
}

function PlatformCard({ videoId, card, hasRender }: { videoId: string; card: PlatformCardView; hasRender: boolean }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5 ${card.awaitingAction ? "bg-wait text-ink" : "bg-paper text-text"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-[17px] font-[750] text-ink">
          {card.label}
        </h4>
        <span className="flex flex-wrap gap-1.5">
          <Chip tone={card.status.tone === "wait" ? "ok" : card.status.tone}>{card.status.label}</Chip>
          <Chip tone="run">{card.modeLabel}</Chip>
        </span>
      </div>
      <p className="text-sm">
        <span className="font-bold text-ink">Créneau :</span> {card.slotLabel}
        {card.externalId ? <span className={`block text-muted ${textWrap}`}>Lien : {card.externalId}</span> : null}
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-bold text-ink">Étiquettes (rapport qualité, non modifiables ici)</p>
        <ul className="flex flex-col gap-0.5">
          <LabelLine name={card.platform === "YOUTUBE" ? "Contenu synthétique (containsSyntheticMedia)" : "Contenu généré par IA"} value={card.labels?.aiLabel ?? null} />
          <LabelLine name={card.platform === "INSTAGRAM" ? "Partenariat rémunéré" : "Contenu de marque"} value={card.labels?.brandedContent ?? null} />
        </ul>
      </div>
      {card.texts ? (
        card.editable ? (
          <PlatformTextsForm videoId={videoId} card={card} texts={card.texts} />
        ) : (
          <ReadOnlyTexts card={card} />
        )
      ) : null}
      <ManualActions card={card} hasRender={hasRender} />
    </section>
  );
}

function ReadOnlyTexts({ card }: { card: PlatformCardView }) {
  if (!card.texts) return null;
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {card.texts.title !== null ? <TextRow term="Titre" value={card.texts.title} /> : null}
      <TextRow term={card.platform === "YOUTUBE" ? "Description" : "Légende"} value={card.texts.body} />
      <TextRow term="Hashtags" value={card.texts.hashtags} />
      {card.texts.cover !== null ? <TextRow term="Texte de couverture" value={card.texts.cover} /> : null}
      {card.texts.pinned !== null ? <TextRow term="Commentaire épinglé" value={card.texts.pinned} /> : null}
    </dl>
  );
}

function TextRow({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-ink">{term}</dt>
      <dd className={`whitespace-pre-line ${textWrap}`}>{value}</dd>
    </div>
  );
}

function ManualActions({ card, hasRender }: { card: PlatformCardView; hasRender: boolean }) {
  if (!card.caption && !card.canMarkPublished) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      {card.caption ? <CopyCaptionButton caption={card.caption} label={card.label} /> : null}
      {card.canMarkPublished && card.publicationId ? <MarkPublishedForm publicationId={card.publicationId} label={card.label} hasRender={hasRender} /> : null}
    </div>
  );
}
