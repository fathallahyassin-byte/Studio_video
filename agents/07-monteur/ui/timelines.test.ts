import { describe, expect, it } from "vitest";
import { makeAssets, makeAudioPlan, makeContext, makePorts, makeTimeline, makeVideo, MEDIA_URLS } from "../fixtures";
import { RENDER_NOT_WIRED, renderAvailability, requestRender } from "../render";
import { normalizeTimeline } from "../rules";
import { NO_VOICE, planMedia } from "../sources";
import { frameAt } from "./frame";
import { toCues, toPendingEdit, toStatus, toTicks, toTimelineView, type TimelineRow } from "./timelines";

const timeline = normalizeTimeline(makeTimeline(), makeContext());
const row: TimelineRow = { id: "v1", label: "V-031", title: "Le trombone", stage: "RENDER", blockedAt: null, blockedReason: null, updatedLabel: "22/11", timelineJson: timeline };

function view(overrides: Partial<TimelineRow> = {}, assets = makeAssets()) {
  const result = toTimelineView({ ...row, ...overrides }, planMedia(assets));
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
    expect(toTimelineView({ ...row, timelineJson: { pistes: 3 } }, [])).toBeNull();
  });

  it("statut : seul ce qui attend l'humain est en jaune", () => {
    expect(toStatus({ stage: "NEEDS_FIX", blockedAt: "EDIT", blockedReason: "Monteur : média manquant" })).toEqual({ label: "À corriger", tone: "wait", notice: "Monteur : média manquant" });
    expect(toStatus({ stage: "EDIT", blockedAt: null, blockedReason: null }).tone).toBe("run");
    expect(toStatus({ stage: "RENDER", blockedAt: null, blockedReason: null }).label).toBe("Rendu en attente");
    expect(toStatus({ stage: "QA", blockedAt: null, blockedReason: null }).tone).toBe("ok");
    expect(view().awaitingRender).toBe(true);
    expect(view({ stage: "QA" }).awaitingRender).toBe(false);
  });

  it("mot actif repéré à sa place, même répété dans le groupe", () => {
    const cues = toCues([
      { mots: "un et un", debut_s: 0, fin_s: 0.3, mot_actif: "un" },
      { mots: "un et un", debut_s: 0.3, fin_s: 0.6, mot_actif: "et" },
      { mots: "un et un", debut_s: 0.6, fin_s: 0.9, mot_actif: "un" },
      { mots: "fin.", debut_s: 0.9, fin_s: 1.2, mot_actif: "fin" },
    ]);
    expect(cues.map((cue) => [cue.before, cue.active, cue.after])).toEqual([
      ["", "un", " et un"],
      ["un ", "et", " un"],
      ["un et ", "un", ""],
      ["", "fin", "."],
    ]);
  });
});

describe("prévisualisation statique", () => {
  const result = view();

  it("plan, texte et sous-titre à l'instant choisi", () => {
    const frame = frameAt(result, 0.7);
    expect(frame.clip).toMatchObject({ plan: "P01", kind: "TEXT" });
    expect(frame.texts.map((text) => text.text)).toEqual(["1899"]);
    expect(frame.cue).toMatchObject({ active: "trombone" });
    expect(frameAt(result, 7).clip).toMatchObject({ plan: "P03", kind: "IMAGE", src: MEDIA_URLS.P03 });
    expect(frameAt(result, 10).clip).toMatchObject({ plan: "P04", kind: "VIDEO" });
  });

  it("instant hors bornes ramené dans la vidéo ; la dernière image montre le dernier plan", () => {
    expect(frameAt(result, -3).timeS).toBe(0);
    const end = frameAt(result, 99);
    expect(end.timeS).toBe(12.2);
    expect(end.clip?.plan).toBe("P04");
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
  it("désactivé avec une note tant que le rendu n'est pas branché", () => {
    expect(renderAvailability()).toEqual({ enabled: false, note: RENDER_NOT_WIRED });
  });

  it("vérifie la vidéo puis explique que le rendu n'est pas branché", async () => {
    expect(await requestRender(makePorts({ video: { stage: "RENDER", timeline } }).ports, "v1")).toEqual({ ok: false, message: RENDER_NOT_WIRED });
    expect((await requestRender(makePorts({ video: { stage: "RENDER", timeline: null } }).ports, "v1")).message).toContain("pas de timeline lisible");
    expect((await requestRender(makePorts({ video: { stage: "QA", timeline } }).ports, "v1")).message).toContain("n'attend pas de rendu");
    const missing = normalizeTimeline(makeTimeline(), makeContext(makeVideo(), makeAssets().filter((asset) => asset.planId !== "P02")));
    expect((await requestRender(makePorts({ video: { stage: "RENDER", timeline: missing } }).ports, "v1")).message).toBe("Rendu impossible : média manquant pour P02.");
    const gone = makePorts();
    gone.ports.loadVideo = async () => null;
    expect((await requestRender(gone.ports, "v1")).message).toBe("Vidéo introuvable.");
  });
});
