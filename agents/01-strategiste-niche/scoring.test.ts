import { describe, expect, it } from "vitest";
import { candidate, CANDIDATES, criteria, makeOutput } from "./fixtures";
import { MAX_SCORE, nicheKey, normalizeStrategy, rankCandidates, weightedScore } from "./scoring";

describe("score pondéré", () => {
  it("applique les pondérations du prompt (demande, faisabilité, profondeur ×2 ; monétisation, risque, différenciation ×1,5 ; concurrence ×1)", () => {
    // demande 5, concurrence 1, monétisation 1, faisabilité 1, profondeur 1, risque 1, différenciation 1
    expect(weightedScore(criteria([5, 1, 1, 1, 1, 1, 1]))).toBe(10 + 1 + 1.5 + 2 + 2 + 1.5 + 1.5);
    expect(weightedScore(criteria([1, 5, 1, 1, 1, 1, 1]))).toBe(2 + 5 + 1.5 + 2 + 2 + 1.5 + 1.5);
    expect(weightedScore(criteria([1, 1, 1, 1, 1, 1, 5]))).toBe(2 + 1 + 1.5 + 2 + 2 + 1.5 + 7.5);
    expect(weightedScore(criteria([5, 3, 4, 5, 5, 5, 4]))).toBe(52.5);
  });

  it("vaut 57,5 au maximum et 11,5 au minimum", () => {
    expect(MAX_SCORE).toBe(57.5);
    expect(weightedScore(criteria([5, 5, 5, 5, 5, 5, 5]))).toBe(57.5);
    expect(weightedScore(criteria([1, 1, 1, 1, 1, 1, 1]))).toBe(11.5);
  });
});

describe("normalize", () => {
  it("ignore le score du modèle et le remplace par le score recalculé", () => {
    const normalized = normalizeStrategy(makeOutput());
    expect(normalized.candidates.map((entry) => entry.score_pondere)).not.toContain(99);
    const objects = normalized.candidates.find((entry) => entry.niche === "Histoire cachée des objets");
    expect(objects?.score_pondere).toBe(52.5);
  });

  it("trie du meilleur au moins bon score recalculé", () => {
    const scores = normalizeStrategy(makeOutput()).candidates.map((entry) => entry.score_pondere);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(normalizeStrategy(makeOutput()).candidates.slice(0, 3).map((entry) => entry.niche)).toEqual([
      "Histoire cachée des objets",
      "Mots et expressions",
      "Inventions ratées",
    ]);
  });

  it("garde l'ordre du modèle à égalité, sans modifier la sortie reçue", () => {
    const tied = [candidate("B", [3, 3, 3, 3, 3, 3, 3], 10), candidate("A", [3, 3, 3, 3, 3, 3, 3], 50)];
    expect(rankCandidates(tied).map((entry) => entry.niche)).toEqual(["B", "A"]);
    expect(tied[1]?.score_pondere).toBe(50);
    expect(CANDIDATES[0]?.score_pondere).toBe(99);
  });
});

describe("nicheKey", () => {
  it("ignore la casse et les espaces en trop", () => {
    expect(nicheKey("  Histoire   cachée des OBJETS ")).toBe(nicheKey("histoire cachée des objets"));
  });
});
