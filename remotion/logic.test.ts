import { describe, expect, it } from "vitest";
import { makeContext, makeTimeline } from "../agents/07-monteur/fixtures";
import { normalizeTimeline } from "../agents/07-monteur/rules";
import {
  ANIMATION_FRAMES,
  clipKind,
  dbToGain,
  DUCKING_LIFT_DB,
  durationInFrames,
  movementAt,
  musicGainAt,
  spanFrames,
  speechSpans,
  splitCues,
  textAppearanceAt,
  textTop,
  transitionAt,
} from "./logic";

const timeline = normalizeTimeline(makeTimeline(), makeContext());

describe("composition Montage : temps", () => {
  it("durée et portions en images (30 i/s)", () => {
    expect(durationInFrames(timeline)).toBe(366);
    expect(spanFrames({ debut_s: 2.5, fin_s: 6 })).toEqual({ from: 75, durationInFrames: 105 });
    expect(spanFrames({ debut_s: 1, fin_s: 1 })).toEqual({ from: 30, durationInFrames: 1 });
  });
});

describe("plans", () => {
  it("type d'après la timeline : texte animé, manquant, vidéo ou image", () => {
    expect(clipKind({ src: "", manquant: false })).toBe("text");
    expect(clipKind({ src: "", manquant: true })).toBe("missing");
    expect(clipKind({ src: "https://media.test/p.mp4?sig=1", manquant: false })).toBe("video");
    expect(clipKind({ src: "https://media.test/p.png", manquant: false })).toBe("image");
  });

  it("mouvements : zoom avant par défaut, zoom arrière, panoramique, fixe", () => {
    expect(movementAt("zoom_in_lent", 0, 90)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(movementAt("zoom_in_lent", 89, 90).scale).toBeCloseTo(1.12);
    expect(movementAt("zoom_out", 0, 90).scale).toBeCloseTo(1.12);
    expect(movementAt("panoramique droite", 89, 90).x).toBeCloseTo(4);
    expect(movementAt("fixe", 50, 90)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("transitions d'entrée sur 0,3 s", () => {
    expect(transitionAt("cut", 0)).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 });
    expect(transitionAt("fondu", 0).opacity).toBe(0);
    expect(transitionAt("fondu", ANIMATION_FRAMES).opacity).toBe(1);
    expect(transitionAt("whip", 0).x).toBe(100);
    expect(transitionAt("zoom", ANIMATION_FRAMES).scale).toBe(1);
  });
});

describe("textes", () => {
  it("entrée et sortie animées de 0,3 s au plus", () => {
    expect(textAppearanceAt("pop", 0, 60).opacity).toBe(0);
    expect(textAppearanceAt("pop", ANIMATION_FRAMES, 60)).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 });
    expect(textAppearanceAt("pop", 59, 60).opacity).toBe(0);
    expect(textAppearanceAt("slide", 30, 60).opacity).toBe(1);
    expect(textAppearanceAt("fondu", 0, 4).opacity).toBe(0);
  });

  it("positions : haut, centre, bas de la zone sûre", () => {
    expect([textTop("haut"), textTop("centre"), textTop("bas_zone_sure")]).toEqual(["12%", "44%", "64%"]);
  });
});

describe("sous-titres", () => {
  it("mot actif repéré à sa place, même répété dans le groupe", () => {
    const cue = (mots: string, mot_actif: string) => ({ mots, mot_actif, debut_s: 0, fin_s: 1 });
    expect(splitCues([cue("un et un", "un"), cue("un et un", "et"), cue("un et un", "un"), cue("fin.", "fin")])).toEqual([
      { before: "", active: "un", after: " et un" },
      { before: "un ", active: "et", after: " un" },
      { before: "un et ", active: "un", after: "" },
      { before: "", active: "fin", after: "." },
    ]);
  });
});

describe("musique et ducking", () => {
  const spans = speechSpans(timeline.pistes.sous_titres);

  it("intervalles de parole fusionnés quand les mots se suivent", () => {
    expect(spans).toEqual([{ from: 0, to: 366 }]);
    expect(speechSpans([{ mots: "a", mot_actif: "a", debut_s: 0, fin_s: 1 }, { mots: "b", mot_actif: "b", debut_s: 3, fin_s: 4 }])).toEqual([
      { from: 0, to: 30 },
      { from: 90, to: 120 },
    ]);
  });

  it("niveau du plan sonore pendant la parole, remontée progressive entre les phrases", () => {
    const gaps = [{ from: 0, to: 30 }, { from: 90, to: 120 }];
    const music = { volume_db: -20, ducking: true };
    expect(musicGainAt(15, music, gaps)).toBeCloseTo(dbToGain(-20));
    expect(musicGainAt(60, music, gaps)).toBeCloseTo(dbToGain(-20 + DUCKING_LIFT_DB));
    expect(musicGainAt(34, music, gaps)).toBeCloseTo(dbToGain(-15));
    expect(musicGainAt(60, { volume_db: -20, ducking: false }, gaps)).toBeCloseTo(dbToGain(-20));
    expect(dbToGain(0)).toBe(1);
  });
});
