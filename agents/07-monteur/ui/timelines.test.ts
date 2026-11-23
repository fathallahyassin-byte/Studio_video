import { describe, expect, it } from "vitest";
import { makeAssets, makeAudioPlan, makeContext, makePorts, makeTimeline, makeVideo } from "../fixtures";
import { RENDER_NOT_CONFIGURED, renderAvailability, requestRender } from "../render";
import { normalizeTimeline } from "../rules";
import { NO_VOICE } from "../sources";
import { toPendingEdit, toStatus, toTicks, toTimelineView, type TimelineRow } from "./timelines";

const timeline = normalizeTimeline(makeTimeline(), makeContext());
const row: TimelineRow = { id: "v1", label: "V-031", title: "Le trombone", stage: "RENDER", blockedAt: null, blockedReason: null, updatedLabel: "22/11", timelineJson: timeline };
const S3_ENV = { S3_BUCKET: "studio", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret", S3_PUBLIC_BASE_URL: "https://media.test" };

function view(overrides: Partial<TimelineRow> = {}, renderUrl: string | null = null) {
  const result = toTimelineView({ ...row, ...overrides }, renderUrl);
  if (!result) throw new Error("timeline illisible");
  return result;
}

describe("modèle de vue de la timeline", () => {
  it("cinq pistes sur la frise : vidéo, texte, sous-titres, voix, musique et effets", () => {
    const tracks = view().tracks;
    expect(tracks.map((track) => track.id)).toEqual(["video", "texte", "sous_titres", "voix", "musique"]);
    const video = tracks[0]?.segments ?? [];
    expect(video.map((segment) => [segment.label, Math.round(segment.left), Math.round(segment.width)])).toEqual([
      ["P01", 0, 20],
      ["P02", 20, 29],
      ["P03", 49, 25],
      ["P04", 74, 26],
    ]);
    expect(tracks[2]?.segments.map((segment) => segment.label)).toEqual([
      "Ton trombone cache un",
      "secret.",
      "Personne ne sait vraiment",
      "qui l'a inventé,",
      "pas même les historiens.",
      "Pourtant la réponse tient",
      "en une seule date.",
    ]);
    expect(tracks[4]?.segments[0]?.label).toBe("Musique · -20 dB · ducking");
  });

  it("la timeline est passée telle quelle au Player, avec le MP4 rendu s'il existe", () => {
    expect(view().timeline).toEqual(timeline);
    expect(view({}, "https://media.test/rendu.mp4").renderUrl).toBe("https://media.test/rendu.mp4");
  });

  it("média manquant : segment et alerte en jaune (attendent l'humain), le reste neutre", () => {
    const missing = normalizeTimeline(makeTimeline(), makeContext(makeVideo(), makeAssets().filter((asset) => asset.planId !== "P03")));
    const result = view({ timelineJson: missing });
    expect(result.tracks[0]?.segments.find((segment) => segment.label.startsWith("P03"))).toMatchObject({ label: "P03 · manquant", tone: "wait" });
    expect(result.alerts.find((alert) => alert.text.startsWith("Média manquant"))?.action).toBe(true);
    expect(result.alerts.find((alert) => alert.text.startsWith("1 effet"))?.action).toBe(false);
  });

  it("format, durée et graduations", () => {
    const result = view();
    expect(result.exportLabel).toBe("1080×1920 · 30 i/s · H264 · AAC 48 kHz");
    expect(result.durationLabel).toBe("12,2 s");
    expect(toTicks(12.2).map((tick) => tick.label)).toEqual(["0 s", "5 s", "10 s"]);
    expect(toTicks(90).map((tick) => tick.label)).toHaveLength(10);
  });

  it("timeline illisible : null", () => {
    expect(toTimelineView({ ...row, timelineJson: { pistes: 3 } })).toBeNull();
  });

  it("statut : seul ce qui attend l'humain est en jaune", () => {
    expect(toStatus({ stage: "NEEDS_FIX", blockedAt: "EDIT", blockedReason: "Monteur : média manquant" })).toEqual({ label: "À corriger", tone: "wait", notice: "Monteur : média manquant" });
    expect(toStatus({ stage: "EDIT", blockedAt: null, blockedReason: null }).tone).toBe("run");
    expect(toStatus({ stage: "RENDER", blockedAt: null, blockedReason: null }).label).toBe("Rendu en attente");
    expect(toStatus({ stage: "QA", blockedAt: null, blockedReason: null }).tone).toBe("ok");
    expect(view().awaitingRender).toBe(true);
    expect(view({ stage: "QA" }).awaitingRender).toBe(false);
  });
});

describe("montages en attente", () => {
  it("dit ce qui manque : voix absente, médias manquants", () => {
    const pending = toPendingEdit({ id: "v2", label: "V-032", title: "Sans voix", video: makeVideo({ audio: makeAudioPlan() }) }, makeAssets().filter((asset) => asset.planId !== "P04"));
    expect(pending).toEqual({ videoId: "v2", label: "V-032", title: "Sans voix", issues: [NO_VOICE, "Média manquant pour P04."], waiting: true, blocked: false });
  });

  it("tout est là : le montage est en cours, rien à faire", () => {
    expect(toPendingEdit({ id: "v3", label: "V-033", title: "Prête", video: makeVideo() }, makeAssets())).toMatchObject({ issues: [], waiting: false, blocked: false });
  });
});

describe("« Lancer le rendu »", () => {
  it("désactivé avec une note tant que le stockage n'est pas configuré", () => {
    expect(renderAvailability({})).toEqual({ enabled: false, note: RENDER_NOT_CONFIGURED });
    expect(renderAvailability(S3_ENV)).toEqual({ enabled: true, note: null });
  });

  it("vérifie la vidéo puis remet la tâche de rendu en file", async () => {
    const enabled = renderAvailability(S3_ENV);
    const ready = makePorts({ video: { stage: "RENDER", timeline } });
    expect(await requestRender(ready.ports, "v1", enabled)).toEqual({ ok: true, message: "Rendu mis en file : le worker le lance dès qu'il est libre." });
    expect(ready.calls.renders).toBe(1);
    expect(await requestRender(makePorts({ video: { stage: "RENDER", timeline } }).ports, "v1", renderAvailability({}))).toEqual({ ok: false, message: RENDER_NOT_CONFIGURED });
    expect((await requestRender(makePorts({ video: { stage: "RENDER", timeline: null } }).ports, "v1", enabled)).message).toContain("pas de timeline lisible");
    expect((await requestRender(makePorts({ video: { stage: "QA", timeline } }).ports, "v1", enabled)).message).toContain("n'attend pas de rendu");
    const missing = normalizeTimeline(makeTimeline(), makeContext(makeVideo(), makeAssets().filter((asset) => asset.planId !== "P02")));
    expect((await requestRender(makePorts({ video: { stage: "RENDER", timeline: missing } }).ports, "v1", enabled)).message).toBe("Rendu impossible : média manquant pour P02.");
    const gone = makePorts();
    gone.ports.loadVideo = async () => null;
    expect((await requestRender(gone.ports, "v1", enabled)).message).toBe("Vidéo introuvable.");
  });

  it("une tâche de rendu déjà active : refus du pipeline relayé", async () => {
    const busy = makePorts({ video: { stage: "RENDER", timeline } });
    busy.ports.queueRender = async () => ({ queued: false, reason: "Un rendu est déjà en file ou en cours pour cette vidéo." });
    expect(await requestRender(busy.ports, "v1", renderAvailability(S3_ENV))).toEqual({ ok: false, message: "Un rendu est déjà en file ou en cours pour cette vidéo." });
  });
});
