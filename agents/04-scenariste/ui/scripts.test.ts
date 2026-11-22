import { describe, expect, it } from "vitest";
import { makeDossier, makeScript, withBeat } from "../fixtures";
import type { ScriptTarget } from "../rules";
import { computeCounters, describeV2Status, formatGap, toBeatViews, toScriptView, type ScriptRow } from "./scripts";

const TARGET: ScriptTarget = { durationS: 25, minDurationS: 20, maxDurationS: 30, wordsPerSecond: 2 };

function makeRow(overrides: Partial<ScriptRow> = {}): ScriptRow {
  return {
    id: "video-1",
    label: "V-007",
    title: "Le trombone",
    stage: "AWAITING_V2",
    blockedAt: null,
    updatedLabel: "22 nov., 10:00",
    lastV2Decision: null,
    lastV2Note: null,
    scriptJson: makeScript(),
    dossierJson: makeDossier(),
    ...overrides,
  };
}

describe("statut V2", () => {
  it("jaune seulement quand l'humain doit agir", () => {
    expect(describeV2Status({ stage: "AWAITING_V2", blockedAt: null, lastV2Decision: null })).toMatchObject({ tone: "wait", notice: expect.any(String) });
    expect(describeV2Status({ stage: "NEEDS_FIX", blockedAt: "SCRIPT", lastV2Decision: null })).toMatchObject({ tone: "wait" });
    expect(describeV2Status({ stage: "SCRIPT", blockedAt: null, lastV2Decision: "CHANGES_REQUESTED" })).toMatchObject({ label: "Correction demandée · en réécriture", notice: null });
    expect(describeV2Status({ stage: "EDIT", blockedAt: null, lastV2Decision: "APPROVED" })).toMatchObject({ label: "V2 validée", tone: "ok" });
    expect(describeV2Status({ stage: "REJECTED", blockedAt: null, lastV2Decision: null })).toMatchObject({ label: "Abandonnée", tone: "run" });
  });
});

describe("compteurs", () => {
  it("mots recomptés, durée estimée et écart avec la cible", () => {
    const counters = computeCounters(makeScript(), TARGET);
    expect(counters).toEqual({ words: 50, estimatedS: 25, targetS: 25, targetWords: 50, gapS: 0, gapPct: 0, withinTolerance: true });
    expect(formatGap(counters)).toBe("±0 s (±0 %)");
  });

  it("écart signé, en secondes et en pourcentage", () => {
    const longer = withBeat(2, { voix: "Tu en utilises des dizaines sans jamais vraiment y penser. Chaque jour, au bureau, partout." });
    const counters = computeCounters(longer, TARGET);
    expect(counters).toMatchObject({ words: 55, estimatedS: 27.5, gapS: 2.5, gapPct: 10, withinTolerance: false });
    expect(formatGap(counters)).toBe("+2,5 s (+10 %)");
  });

  it("sans bible : pas de cible, durée tirée du script", () => {
    expect(computeCounters(makeScript(), null)).toMatchObject({ words: 50, estimatedS: 25, targetS: null, gapS: null, withinTolerance: null });
  });
});

describe("frise", () => {
  it("place chaque beat en % de la durée totale", () => {
    const { beats, totalS } = toBeatViews(makeScript().beats);
    expect(totalS).toBe(25);
    expect(beats[0]).toMatchObject({ n: 1, roleLabel: "Accroche", offsetPct: 0, widthPct: 12, timeLabel: "0–3 s" });
    expect(beats[2]).toMatchObject({ offsetPct: 32, widthPct: 28, factIds: ["F1"] });
  });
});

describe("vue d'un script", () => {
  it("accroches, faits du dossier et note de correction", () => {
    const view = toScriptView(makeRow({ stage: "SCRIPT", lastV2Decision: "CHANGES_REQUESTED", lastV2Note: "Chute plus forte" }), TARGET);
    expect(view?.hooks.map((hook) => [hook.type, hook.recommended])).toEqual([
      ["Affirmation", true],
      ["Question", false],
      ["Mise en situation", false],
    ]);
    expect(view?.facts.F1).toMatchObject({ confidenceLabel: "confiance élevée", href: "https://example.org/f1" });
    expect(view?.facts.F3).toMatchObject({ href: null });
    expect(view?.correctionNote).toBe("Chute plus forte");
  });

  it("script illisible : null ; dossier illisible : aucun fait", () => {
    expect(toScriptView(makeRow({ scriptJson: { titre: "abîmé" } }), TARGET)).toBeNull();
    expect(toScriptView(makeRow({ dossierJson: null }), TARGET)?.facts).toEqual({});
  });
});
