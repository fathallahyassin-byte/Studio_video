import { describe, expect, it } from "vitest";
import type { ControlResult } from "@/agents/_shared/types";
import { BIBLE_TEMPLATE, candidate, CANDIDATES, fillTemplate, makeOutput, PAYLOAD } from "./fixtures";
import {
  checkAccountsToStudy,
  checkCandidateCount,
  checkJustifications,
  checkProposedBible,
  checkRecommendation,
  checkStrategy,
  checkTestPlan,
  checkTitles,
  checkTop3,
  checkUniqueNiches,
  missingTemplateKeys,
} from "./rules";
import type { Output } from "./schema";

const reasonOf = (result: ControlResult) => (result.ok ? "" : result.reason);
const top3With = (output: Output, index: number, patch: Partial<Output["top3"][number]>): Output["top3"] =>
  output.top3.map((entry, position) => (position === index ? { ...entry, ...patch } : entry));

describe("sortie valide", () => {
  it("passe tous les contrôles", () => {
    const results = checkStrategy(makeOutput(), { payload: PAYLOAD, bibleTemplate: BIBLE_TEMPLATE });
    expect(results.filter((result) => !result.ok)).toEqual([]);
  });
});

describe("niches candidates", () => {
  it("refuse une niche en double (casse ignorée)", () => {
    const result = checkUniqueNiches([...CANDIDATES, candidate("inventions RATÉES", [3, 3, 3, 3, 3, 3, 3])]);
    expect(reasonOf(result)).toContain("Niches candidates en double : inventions RATÉES");
  });

  it("refuse une niche sans public ou sans angle", () => {
    const result = checkUniqueNiches([{ ...candidate("X", [3, 3, 3, 3, 3, 3, 3]), angle: "  " }]);
    expect(reasonOf(result)).toContain("1 niche(s) candidate(s) sans nom, public ou angle");
  });

  it("moins de 8 pistes : exige 12 candidates", () => {
    expect(reasonOf(checkCandidateCount(CANDIDATES.slice(0, 10), PAYLOAD))).toContain("il faut 12 niches candidates, pas 10");
    expect(checkCandidateCount(CANDIDATES, PAYLOAD).ok).toBe(true);
    expect(checkCandidateCount(CANDIDATES.slice(0, 10), { ...PAYLOAD, pistes: [] }).ok).toBe(false);
  });

  it("8 pistes ou plus : 8 candidates suffisent", () => {
    const pistes = Array.from({ length: 8 }, (_, index) => `piste ${index}`);
    expect(checkCandidateCount(CANDIDATES.slice(0, 8), { ...PAYLOAD, pistes }).ok).toBe(true);
  });

  it("refuse une note sans justification", () => {
    const blank = candidate("Sans raison", [3, 3, 3, 3, 3, 3, 3]);
    blank.criteres.risque = { note: 3, pourquoi: "   " };
    expect(reasonOf(checkJustifications([blank]))).toContain("Sans raison (risque)");
  });
});

describe("top 3", () => {
  it("refuse un top 3 qui ne reprend pas les 3 meilleurs scores recalculés", () => {
    const output = makeOutput();
    const result = checkTop3({ ...output, top3: top3With(output, 2, { niche: "Physique du quotidien" }) });
    expect(reasonOf(result)).toContain("3ᵉ score : 48");
    expect(reasonOf(result)).toContain("Physique du quotidien (45.5)");
  });

  it("se fie au score recalculé, pas à celui du modèle", () => {
    const output = makeOutput();
    const candidates = output.candidates.map((entry) => (entry.niche === "Physique du quotidien" ? { ...entry, score_pondere: 57 } : entry));
    expect(checkTop3({ ...output, candidates, top3: top3With(output, 2, { niche: "Physique du quotidien" }) }).ok).toBe(false);
  });

  it("accepte une égalité avec la 3ᵉ", () => {
    const output = makeOutput();
    const candidates = [...output.candidates, candidate("Ex aequo", [4, 4, 3, 5, 4, 5, 4])];
    expect(checkTop3({ ...output, candidates, top3: top3With(output, 2, { niche: "Ex aequo" }) }).ok).toBe(true);
  });

  it("refuse une niche absente des candidates ou en double", () => {
    const output = makeOutput();
    expect(reasonOf(checkTop3({ ...output, top3: top3With(output, 1, { niche: "Inconnue" }) }))).toContain("hors des candidates : Inconnue");
    expect(reasonOf(checkTop3({ ...output, top3: top3With(output, 1, { niche: "histoire cachée des objets" }) }))).toContain("Top 3 en double");
  });

  it("exige 10 titres distincts et non vides", () => {
    const output = makeOutput();
    const repeated = Array.from({ length: 10 }, () => "Même titre");
    expect(reasonOf(checkTitles(top3With(output, 0, { exemples_titres: repeated })))).toContain("Histoire cachée des objets : 1 titre(s) distinct(s)");
    const blank = [...(output.top3[1]?.exemples_titres.slice(0, 9) ?? []), " "];
    expect(reasonOf(checkTitles(top3With(output, 1, { exemples_titres: blank })))).toContain("Mots et expressions : 9 titre(s)");
  });

  it("exige 3 comptes ou formats à étudier", () => {
    const output = makeOutput();
    expect(reasonOf(checkAccountsToStudy(top3With(output, 2, { a_etudier: ["un seul"] })))).toContain("pour : Inventions ratées");
  });
});

describe("recommandation et plan de test", () => {
  it("la niche recommandée fait partie du top 3", () => {
    const output = makeOutput({ recommandation: { niche: "Physique du quotidien", pourquoi: "parce que", risques: ["x"] } });
    expect(reasonOf(checkRecommendation(output))).toContain("doit faire partie du top 3");
  });

  it("exige une raison et au moins un risque", () => {
    expect(reasonOf(checkRecommendation(makeOutput({ recommandation: { niche: "Mots et expressions", pourquoi: " ", risques: ["x"] } })))).toContain("pourquoi");
    expect(reasonOf(checkRecommendation(makeOutput({ recommandation: { niche: "Mots et expressions", pourquoi: "ok", risques: [" "] } })))).toContain("au moins un risque");
  });

  it("20 vidéos en 4 semaines, avec un critère chiffré", () => {
    expect(reasonOf(checkTestPlan({ nb_videos: 12, semaines: 4, critere_validation: "40 %" }))).toContain("reçu : 12 en 4");
    expect(reasonOf(checkTestPlan({ nb_videos: 20, semaines: 4, critere_validation: "de bons résultats" }))).toContain("chiffré");
    expect(checkTestPlan({ nb_videos: 20, semaines: 4, critere_validation: "1 000 abonnés" }).ok).toBe(true);
  });
});

describe("bible proposée", () => {
  it("accepte le modèle entièrement rempli", () => {
    expect(checkProposedBible(fillTemplate(), BIBLE_TEMPLATE).ok).toBe(true);
  });

  it("refuse le modèle laissé avec ses {{…}}", () => {
    expect(reasonOf(checkProposedBible(BIBLE_TEMPLATE, BIBLE_TEMPLATE))).toContain("{{NOM}}");
  });

  it("refuse un YAML illisible ou sans les clés lues par les agents", () => {
    expect(reasonOf(checkProposedBible("chaine: [", BIBLE_TEMPLATE))).toContain("YAML invalide");
    expect(reasonOf(checkProposedBible("chaine:\n  nom: x\n", BIBLE_TEMPLATE))).toContain("Bible incomplète");
  });

  it("refuse une bible qui perd des clés du modèle", () => {
    const withoutAudience = fillTemplate().replace(/^audience:\n(?: {2}.*\n)+\n/m, "");
    expect(missingTemplateKeys(withoutAudience, BIBLE_TEMPLATE)).toEqual(["audience", "audience.persona", "audience.niveau", "audience.pays"]);
    expect(reasonOf(checkProposedBible(withoutAudience, BIBLE_TEMPLATE))).toContain("clés absentes : audience, audience.persona");
  });
});
