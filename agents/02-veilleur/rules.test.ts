import { describe, expect, it } from "vitest";
import {
  averageNote,
  checkForbiddenSubjects,
  checkNoDuplicateIdeas,
  checkPillarShare,
  checkPillarsFromBible,
  checkSeriesCount,
  checkUniqueIds,
  claimedAdjustments,
  normalizeScout,
  recomputeScore,
  scoutControls,
  type ScoutContext,
} from "./rules";
import { outputSchema } from "./schema";
import { BASE_NOTES, makeIdea, makeOutput, PILLARS } from "./testing";

const context: ScoutContext = {
  week: "2026-W47",
  hasSignals: true,
  hasLearnings: true,
  backlogTitles: [],
  pillars: PILLARS,
  sujetsInterdits: ["conseil médical", "politique"],
};

describe("schéma de sortie", () => {
  it("accepte une sortie conforme au prompt", () => {
    expect(outputSchema.safeParse(makeOutput()).success).toBe(true);
  });

  it("refuse 19 idées, une note hors de 1 à 5 ou une semaine mal formée", () => {
    expect(outputSchema.safeParse(makeOutput({ idees: makeOutput().idees.slice(1) })).success).toBe(false);
    const badNote = makeOutput({ idees: makeOutput().idees.map((idea, index) => (index === 0 ? { ...idea, notes: { ...BASE_NOTES, interet: 6 } } : idea)) });
    expect(outputSchema.safeParse(badNote).success).toBe(false);
    expect(outputSchema.safeParse(makeOutput({ semaine: "semaine 47" })).success).toBe(false);
  });
});

describe("score recalculé en code", () => {
  it("fait la moyenne des 5 notes", () => {
    expect(averageNote(BASE_NOTES)).toBe(4);
  });

  it("déduit du score du modèle le bonus et la pénalité qu'il a appliqués", () => {
    expect(claimedAdjustments(4, 4)).toEqual({ bonus: false, penalty: false });
    expect(claimedAdjustments(4.5, 4)).toEqual({ bonus: true, penalty: false });
    expect(claimedAdjustments(3, 4)).toEqual({ bonus: false, penalty: true });
    expect(claimedAdjustments(3.5, 4)).toEqual({ bonus: true, penalty: true });
    expect(claimedAdjustments(4.1, 4)).toEqual({ bonus: false, penalty: false });
  });

  it("remplace un score inventé par la moyenne", () => {
    expect(recomputeScore(makeIdea(0, { score: 4.9 }), context)).toBe(4.5);
    expect(recomputeScore(makeIdea(0, { score: 4.2 }), context)).toBe(4);
  });

  it("accorde +0,5 seulement si l'analyste a donné des enseignements", () => {
    const idea = makeIdea(0, { score: 4.5 });
    expect(recomputeScore(idea, context)).toBe(4.5);
    expect(recomputeScore(idea, { ...context, hasLearnings: false })).toBe(4);
  });

  it("retire 1 quand le code trouve un titre proche, même si le modèle l'a oublié", () => {
    const idea = makeIdea(4, { score: 4 });
    expect(recomputeScore(idea, { ...context, backlogTitles: ["Pourquoi les crayons sont jaunes"] })).toBe(3);
  });

  it("ne retire 1 qu'une fois quand le modèle et le code voient la ressemblance", () => {
    const idea = makeIdea(4, { score: 3 });
    expect(recomputeScore(idea, { ...context, backlogTitles: ["Pourquoi les crayons sont jaunes"] })).toBe(3);
  });

  it("arrondit au dixième", () => {
    const idea = makeIdea(0, { notes: { accroche: 5, interet: 4, originalite: 4, faisabilite_visuelle: 4, verifiabilite: 4 }, score: 4.2 });
    expect(recomputeScore(idea, context)).toBe(4.2);
  });
});

describe("normalizeScout", () => {
  it("fixe la semaine, recalcule les scores et trie par score décroissant", () => {
    const idees = makeOutput().idees.map((idea, index) => (index === 5 ? { ...idea, notes: { ...BASE_NOTES, originalite: 5 }, score: 4.4 } : idea));
    const result = normalizeScout(makeOutput({ semaine: "2020-W01", idees }), context);
    expect(result.semaine).toBe("2026-W47");
    expect(result.idees[0]?.id).toBe("IDEE-006");
    expect(result.idees[0]?.score).toBe(4.4);
    const scores = result.idees.map((idea) => idea.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("force hypothese = true quand aucun signal n'a été fourni", () => {
    const result = normalizeScout(makeOutput(), { ...context, hasSignals: false });
    expect(result.idees.every((idea) => idea.hypothese)).toBe(true);
    expect(normalizeScout(makeOutput(), context).idees.some((idea) => idea.hypothese)).toBe(false);
  });
});

describe("contrôles en code", () => {
  it("acceptent une sortie conforme", () => {
    expect(scoutControls(makeOutput(), context).every((result) => result.ok)).toBe(true);
  });

  it("refusent deux idées avec le même identifiant", () => {
    const idees = makeOutput().idees.map((idea, index) => (index === 1 ? { ...idea, id: "IDEE-001" } : idea));
    expect(checkUniqueIds(makeOutput({ idees }))).toEqual({ ok: false, reason: expect.stringContaining("IDEE-001") });
  });

  it("refusent un pilier au-dessus de 40 %", () => {
    const idees = makeOutput().idees.map((idea, index) => (index < 9 ? { ...idea, pilier: "objets de LA cuisine" } : { ...idea, pilier: "Objets du bureau" }));
    expect(checkPillarShare(makeOutput({ idees }))).toEqual({ ok: false, reason: expect.stringContaining("en a 11") });
    const atLimit = makeOutput().idees.map((idea, index) => ({ ...idea, pilier: PILLARS[index < 8 ? 0 : index < 16 ? 1 : 2] ?? "" }));
    expect(checkPillarShare(makeOutput({ idees: atLimit })).ok).toBe(true);
  });

  it("refusent un pilier absent de la bible, sans tenir compte des accents ni de la casse", () => {
    const idees = makeOutput().idees.map((idea, index) => (index === 0 ? { ...idea, pilier: "Objets du jardin" } : idea));
    expect(checkPillarsFromBible(makeOutput({ idees }), PILLARS)).toEqual({ ok: false, reason: expect.stringContaining("Objets du jardin") });
    const accents = makeOutput().idees.map((idea) => ({ ...idea, pilier: idea.pilier.toUpperCase() }));
    expect(checkPillarsFromBible(makeOutput({ idees: accents }), PILLARS).ok).toBe(true);
  });

  it("ignorent les piliers tant que la bible garde ceux du modèle", () => {
    expect(checkPillarsFromBible(makeOutput(), ["{{PILIER_1}}", "{{PILIER_2}}"]).ok).toBe(true);
  });

  it("exigent exactement 3 séries", () => {
    expect(checkSeriesCount(makeOutput({ series: makeOutput().series.slice(0, 2) })).ok).toBe(false);
  });

  it("refusent deux idées qui donneraient la même vidéo", () => {
    const idees = makeOutput().idees.map((idea, index) => (index === 19 ? { ...idea, angle: "Le secret caché du trombone" } : idea));
    expect(checkNoDuplicateIdeas(makeOutput({ idees }))).toEqual({ ok: false, reason: expect.stringContaining("IDEE-009 et IDEE-020") });
  });

  it("refusent un sujet interdit par la bible, mot pour mot", () => {
    const idees = makeOutput().idees.map((idea, index) => (index === 2 ? { ...idea, accroche: "Un conseil médical surprenant" } : idea));
    expect(checkForbiddenSubjects(makeOutput({ idees }), context.sujetsInterdits)).toEqual({ ok: false, reason: expect.stringContaining("IDEE-003") });
    const nearMiss = makeOutput().idees.map((idea, index) => (index === 2 ? { ...idea, accroche: "Les politiques tarifaires des fabricants" } : idea));
    expect(checkForbiddenSubjects(makeOutput({ idees: nearMiss }), context.sujetsInterdits).ok).toBe(true);
  });
});
