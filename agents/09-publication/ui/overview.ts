import { readPublicationLabels, type PublicationLabels } from "@/agents/08-controle-qualite/labels";
import type { ChipTone } from "@/components/ui";
import { formatVideoNumber } from "@/lib/dashboard/format";
import type { Platform, PublicationStatus, PublishMode, Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { composeCaption, platformLabel, PLATFORMS, slotOf, textsFor } from "../platforms";
import { outputSchema, type Output } from "../schema";
import { addDays, formatDay, formatLongSlot, formatSlot, formatTime, sameDay, startOfWeek } from "../slots";

// Modèle de vue du panneau (données sérialisables, passées aux composants clients). Pur : testé sans base.

export type PublicationInput = {
  id: string;
  platform: Platform;
  mode: PublishMode;
  status: PublicationStatus;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  externalId: string | null;
  aiLabel: boolean;
  brandedContent: boolean;
};

export type VideoInput = {
  id: string;
  number: number;
  title: string;
  stage: Stage;
  publishJson: unknown;
  qaJson: unknown;
  hasV3Approval: boolean;
  renderUrl: string | null;
  publications: PublicationInput[];
};

export type StatusView = { label: string; tone: ChipTone };

export type PlatformTextsView = { body: string; hashtags: string; title: string | null; cover: string | null; pinned: string | null };

export type PlatformCardView = {
  platform: Platform;
  label: string;
  publicationId: string | null;
  status: StatusView;
  modeLabel: string;
  slotLabel: string;
  /** valeur du champ datetime-local */
  slotValue: string;
  /** étiquettes du rapport qualité (lecture seule) ; null si le rapport est illisible */
  labels: PublicationLabels | null;
  texts: PlatformTextsView | null;
  caption: string | null;
  editable: boolean;
  canMarkPublished: boolean;
  /** l'humain doit agir maintenant (publication manuelle due, échec) : seul cas affiché en jaune */
  awaitingAction: boolean;
  externalId: string | null;
};

export type VideoView = {
  videoId: string;
  label: string;
  title: string;
  stageLabel: string;
  status: StatusView;
  renderUrl: string | null;
  textsReady: boolean;
  hasV3Approval: boolean;
  cards: PlatformCardView[];
  awaitingAction: boolean;
};

export type CalendarEntry = { key: string; videoId: string; label: string; title: string; time: string; status: StatusView; awaitingAction: boolean };

export type CalendarRow = { platform: Platform; label: string; cells: CalendarEntry[][] };

export type WeekView = { title: string; days: { key: string; label: string; isToday: boolean }[]; rows: CalendarRow[]; count: number };

const statusViews: Record<PublicationStatus, StatusView> = {
  SCHEDULED: { label: "Programmée", tone: "run" },
  PUBLISHING: { label: "Envoi en cours", tone: "run" },
  PUBLISHED: { label: "Publiée", tone: "ok" },
  FAILED: { label: "Échec : à vérifier", tone: "wait" },
};

export function parseTexts(publishJson: unknown): Output | null {
  const parsed = outputSchema.safeParse(publishJson);
  return parsed.success ? parsed.data : null;
}

/** Due et manuelle (ou en échec) : l'humain doit publier ou vérifier lui-même. */
export function needsHuman(publication: PublicationInput, now: Date): boolean {
  if (publication.status === "FAILED") return true;
  if (publication.status !== "SCHEDULED" || publication.mode !== "MANUAL") return false;
  return publication.scheduledFor !== null && publication.scheduledFor.getTime() <= now.getTime();
}

function publicationStatus(publication: PublicationInput | null, now: Date): StatusView {
  if (!publication) return { label: "Pas de publication", tone: "run" };
  if (needsHuman(publication, now) && publication.status === "SCHEDULED") return { label: "À publier à la main", tone: "wait" };
  return statusViews[publication.status];
}

function textsView(texts: Output, platform: Platform): PlatformTextsView {
  const base = textsFor(texts, platform);
  const hashtags = base.hashtags.join(" ");
  if (platform === "TIKTOK") return { body: base.body, hashtags, title: null, cover: texts.tiktok.texte_couverture, pinned: texts.tiktok.commentaire_epingle };
  if (platform === "INSTAGRAM") return { body: base.body, hashtags, title: null, cover: texts.instagram.texte_couverture, pinned: null };
  return { body: base.body, hashtags, title: base.title, cover: null, pinned: texts.youtube.commentaire_epingle };
}

function slotDate(publication: PublicationInput | null, texts: Output | null, platform: Platform): { label: string; value: string } {
  const date = publication?.status === "PUBLISHED" ? publication.publishedAt : (publication?.scheduledFor ?? null);
  if (date) return { label: `${publication?.status === "PUBLISHED" ? "Publiée " : ""}${formatLongSlot(date)}`, value: formatSlot(date) };
  return { label: "Créneau non fixé", value: texts ? slotOf(texts, platform) : "" };
}

function buildCard(video: VideoInput, platform: Platform, texts: Output | null, now: Date): PlatformCardView {
  const publication = video.publications.find((entry) => entry.platform === platform) ?? null;
  const slot = slotDate(publication, texts, platform);
  const allowed = video.hasV3Approval && (video.stage === "SCHEDULED" || video.stage === "PUBLISHED");
  return {
    platform,
    label: platformLabel(platform),
    publicationId: publication?.id ?? null,
    status: publicationStatus(publication, now),
    modeLabel: publication?.mode === "API" ? "Par API" : "Publication manuelle",
    slotLabel: slot.label,
    slotValue: slot.value,
    labels: readPublicationLabels(video.qaJson)?.[platform] ?? null,
    texts: texts ? textsView(texts, platform) : null,
    caption: texts ? composeCaption(textsFor(texts, platform)) : null,
    editable: texts !== null && publication?.status === "SCHEDULED",
    canMarkPublished: allowed && publication !== null && publication.status !== "PUBLISHED",
    awaitingAction: publication !== null && needsHuman(publication, now),
    externalId: publication?.externalId ?? null,
  };
}

function videoStatus(video: VideoInput, cards: readonly PlatformCardView[], textsReady: boolean): StatusView {
  if (cards.some((card) => card.awaitingAction)) return { label: "À publier à la main", tone: "wait" };
  if (video.stage === "PUBLISHED") return { label: "Publiée", tone: "ok" };
  if (!textsReady) return { label: "Textes en préparation", tone: "run" };
  return { label: "Programmée", tone: "run" };
}

export function buildVideoView(video: VideoInput, now: Date): VideoView {
  const texts = parseTexts(video.publishJson);
  const platforms = PLATFORMS.map((info) => info.platform).filter((platform) => texts !== null || video.publications.some((entry) => entry.platform === platform));
  const cards = platforms.map((platform) => buildCard(video, platform, texts, now));
  return {
    videoId: video.id,
    label: formatVideoNumber(video.number),
    title: video.title,
    stageLabel: stageLabels[video.stage],
    status: videoStatus(video, cards, texts !== null),
    renderUrl: safeUrl(video.renderUrl),
    textsReady: texts !== null,
    hasV3Approval: video.hasV3Approval,
    cards,
    awaitingAction: cards.some((card) => card.awaitingAction),
  };
}

/** Seules les URL http(s) deviennent des liens. */
export function safeUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Calendrier d'une semaine (lundi à dimanche) : une ligne par plateforme, une case par jour. */
export function buildWeek(videos: readonly VideoInput[], weekStart: Date, now: Date, title: string): WeekView {
  const days = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(weekStart), index));
  let count = 0;
  const rows = PLATFORMS.map(({ platform, label }) => {
    const cells = days.map((day) => {
      const entries = entriesFor(videos, platform, day, now);
      count += entries.length;
      return entries;
    });
    return { platform, label, cells };
  });
  return { title, days: days.map((day) => ({ key: formatSlot(day), label: formatDay(day), isToday: sameDay(day, now) })), rows, count };
}

function entriesFor(videos: readonly VideoInput[], platform: Platform, day: Date, now: Date): CalendarEntry[] {
  return videos
    .flatMap((video) => video.publications.filter((entry) => entry.platform === platform).map((publication) => ({ video, publication })))
    .map(({ video, publication }) => ({ video, publication, date: publication.status === "PUBLISHED" ? publication.publishedAt : publication.scheduledFor }))
    .filter((entry): entry is typeof entry & { date: Date } => entry.date !== null && sameDay(entry.date, day))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ video, publication, date }) => ({
      key: publication.id,
      videoId: video.id,
      label: formatVideoNumber(video.number),
      title: video.title,
      time: formatTime(date),
      status: publicationStatus(publication, now),
      awaitingAction: needsHuman(publication, now),
    }));
}

export type PublicationOverview = { weeks: WeekView[]; videos: VideoView[] };

export function buildOverview(videos: readonly VideoInput[], now: Date): PublicationOverview {
  const thisWeek = startOfWeek(now);
  return {
    weeks: [buildWeek(videos, thisWeek, now, "Cette semaine"), buildWeek(videos, addDays(thisWeek, 7), now, "Semaine prochaine")],
    videos: videos.map((video) => buildVideoView(video, now)),
  };
}
