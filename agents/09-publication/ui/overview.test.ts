import { describe, expect, it } from "vitest";
import { makeOutput, makeReport, NOW } from "../fixtures";
import { buildOverview, buildVideoView, safeUrl, type PublicationInput, type VideoInput } from "./overview";

function publication(overrides: Partial<PublicationInput> = {}): PublicationInput {
  return {
    id: "pub-tiktok",
    platform: "TIKTOK",
    mode: "MANUAL",
    status: "SCHEDULED",
    scheduledFor: new Date(2026, 10, 24, 18, 0),
    publishedAt: null,
    externalId: null,
    aiLabel: true,
    brandedContent: false,
    ...overrides,
  };
}

function video(overrides: Partial<VideoInput> = {}): VideoInput {
  return {
    id: "video-1",
    number: 7,
    title: "Le secret du trombone",
    stage: "SCHEDULED",
    publishJson: makeOutput(),
    qaJson: makeReport(),
    hasV3Approval: true,
    renderUrl: "https://media.example.org/v1.mp4",
    publications: [
      publication(),
      publication({ id: "pub-ig", platform: "INSTAGRAM", scheduledFor: new Date(2026, 10, 24, 12, 30) }),
      publication({ id: "pub-yt", platform: "YOUTUBE", scheduledFor: new Date(2026, 10, 25, 17, 0), aiLabel: false }),
    ],
    ...overrides,
  };
}

describe("calendrier de la semaine", () => {
  it("une ligne par plateforme, une case par jour du lundi au dimanche", () => {
    const [thisWeek, nextWeek] = buildOverview([video()], NOW).weeks;
    expect(thisWeek?.days.map((day) => day.isToday)).toEqual([true, false, false, false, false, false, false]);
    expect(thisWeek?.rows.map((row) => row.label)).toEqual(["TikTok", "Instagram Reels", "YouTube Shorts"]);
    expect(thisWeek?.rows[0]?.cells[1]).toEqual([expect.objectContaining({ label: "V-007", time: "18:00", awaitingAction: false })]);
    expect(thisWeek?.rows[2]?.cells[2]?.[0]?.time).toBe("17:00");
    expect(thisWeek?.count).toBe(3);
    expect(nextWeek?.count).toBe(0);
  });

  it("une publication manuelle dont l'heure est passée attend l'humain (jaune)", () => {
    const overdue = video({ publications: [publication({ scheduledFor: new Date(2026, 10, 23, 9, 0) })] });
    const { weeks, videos } = buildOverview([overdue], NOW);
    expect(weeks[0]?.rows[0]?.cells[0]?.[0]).toMatchObject({ awaitingAction: true, status: { label: "À publier à la main", tone: "wait" } });
    expect(videos[0]?.status).toEqual({ label: "À publier à la main", tone: "wait" });
    expect(videos[0]?.awaitingAction).toBe(true);
  });
});

describe("détail d'une vidéo", () => {
  it("textes modifiables, légende à copier, étiquettes du rapport qualité en lecture seule", () => {
    const view = buildVideoView(video(), NOW);
    const tiktok = view.cards[0];
    expect(view.cards.map((card) => card.platform)).toEqual(["TIKTOK", "INSTAGRAM", "YOUTUBE"]);
    expect(tiktok).toMatchObject({ editable: true, canMarkPublished: true, modeLabel: "Publication manuelle", slotValue: "2026-11-24T18:00", labels: { aiLabel: true, brandedContent: false } });
    expect(tiktok?.caption).toBe(`${makeOutput().tiktok.legende}\n\n#objets #histoiredesobjets #trombone #brevet1899`);
    expect(view.cards[2]?.texts?.title).toBe(makeOutput().youtube.titre);
    expect(view.cards[2]?.labels?.aiLabel).toBe(false);
  });

  it("sans V3 approuvée : impossible de marquer comme publié", () => {
    expect(buildVideoView(video({ hasV3Approval: false }), NOW).cards.every((card) => !card.canMarkPublished)).toBe(true);
  });

  it("publication déjà publiée : plus modifiable, plus de bouton", () => {
    const view = buildVideoView(video({ publications: [publication({ status: "PUBLISHED", publishedAt: new Date(2026, 10, 23, 8, 0), externalId: "https://x.test/1" })] }), NOW);
    expect(view.cards[0]).toMatchObject({ editable: false, canMarkPublished: false, status: { label: "Publiée" }, externalId: "https://x.test/1" });
  });

  it("textes pas encore rédigés : statut explicite, aucune carte inventée", () => {
    const view = buildVideoView(video({ publishJson: null, publications: [] }), NOW);
    expect(view).toMatchObject({ textsReady: false, status: { label: "Textes en préparation" }, cards: [] });
  });

  it("rapport qualité illisible : étiquettes inconnues (jamais « non » par défaut)", () => {
    expect(buildVideoView(video({ qaJson: null }), NOW).cards[0]?.labels).toBeNull();
  });

  it("seules les URL http(s) du MP4 deviennent des liens", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("rendus/v1.mp4")).toBeNull();
    expect(safeUrl("https://media.example.org/v1.mp4")).toBe("https://media.example.org/v1.mp4");
  });
});
