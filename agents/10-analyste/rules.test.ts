import { describe, expect, it } from "vitest";
import type { ControlResult } from "@/agents/_shared/types";
import { makeReport, makeSample, NOW, SAMPLES, VIDEOS } from "./fixtures";
import { checkCitedPercents, checkExperiments, checkRanking, checkReport, extractPercents, isSingleVariable, normalizeReport } from "./rules";
import { buildSnapshot } from "./snapshot";
import type { RunningExperiment } from "./variables";

const snapshot = buildSnapshot({ now: NOW, samples: SAMPLES, videos: VIDEOS });
const failures = (results: ControlResult[]) => results.flatMap((result) => (result.ok ? [] : [result.reason]));
const check = (overrides: Parameters<typeof makeReport>[0], running: RunningExperiment[] = []) =>
  failures(checkReport(normalizeReport(makeReport(overrides), snapshot), snapshot, running));

describe("normalizeReport", () => {
  it("fixe la période en code et force « faible » sous 5 vidéos", () => {
    const output = normalizeReport(makeReport(), snapshot);
    expect(output.periode).toBe("2026-W48");
    expect(output.enseignements[0]).toMatchObject({ nb_videos: 2, confiance: "faible" });
  });

  it("garde « forte » à partir de 5 vidéos", () => {
    const learning = { observation: "x", nb_videos: 5, confiance: "forte" as const, decision: "y" };
    expect(normalizeReport(makeReport({ enseignements: [learning] }), snapshot).enseignements[0]?.confiance).toBe("forte");
  });

  it("nettoie les mises à jour de la bible et du backlog (espaces, doublons, lignes vides)", () => {
    const output = normalizeReport(makeReport({ maj_backlog: { prioriser: [" A ", "A"], abandonner: [""], series: [] } }), snapshot);
    expect(output.maj_bible).toEqual(["Les accroches en question retiennent mieux"]);
    expect(output.maj_backlog).toEqual({ prioriser: ["A"], abandonner: [], series: [] });
  });
});

describe("checkReport : sortie valide", () => {
  it("accepte le rapport de référence", () => {
    expect(check({})).toEqual([]);
  });
});

describe("top et flop", () => {
  it("refuse un video_id inconnu", () => {
    expect(check({ top: [{ video_id: "v-zz", pourquoi: "?" }, { video_id: "v-b", pourquoi: "" }] }).join()).toMatch(/inconnu.*v-zz/);
  });

  it("refuse une vidéo de moins de 72 h dans le top", () => {
    expect(check({ top: [{ video_id: "v-new", pourquoi: "énorme" }, { video_id: "v-a", pourquoi: "" }] }).join()).toMatch(/v-new exclue/);
  });

  it("exige le nombre attendu (2 et 2 pour 4 vidéos comparables)", () => {
    expect(check({ top: [{ video_id: "v-a", pourquoi: "" }] }).join()).toMatch(/top : 2 vidéo\(s\) attendue\(s\).*1 reçue/);
  });

  it("refuse une vidéo dans le top et le flop, ou deux fois dans la même liste", () => {
    expect(check({ flop: [{ video_id: "v-a", pourquoi: "" }, { video_id: "v-d", pourquoi: "" }] }).join()).toMatch(/à la fois dans le top et le flop/);
    expect(check({ top: [{ video_id: "v-a", pourquoi: "" }, { video_id: "v-a", pourquoi: "" }] }).join()).toMatch(/plusieurs fois/);
  });

  it("refuse un top moins bien classé qu'une vidéo du flop", () => {
    const swapped = makeReport({ top: [{ video_id: "v-a", pourquoi: "" }, { video_id: "v-c", pourquoi: "" }], flop: [{ video_id: "v-d", pourquoi: "" }, { video_id: "v-b", pourquoi: "" }] });
    expect(failures(checkRanking(swapped, snapshot)).join()).toMatch(/moins bien classée/);
  });

  it("accepte un flop vide quand une seule vidéo est comparable", () => {
    const single = buildSnapshot({ now: NOW, samples: [makeSample("v-a", "TIKTOK", 100)], videos: VIDEOS });
    const output = makeReport({ top: [{ video_id: "v-a", pourquoi: "seule vidéo" }], flop: [] });
    expect(failures(checkRanking(output, single))).toEqual([]);
  });
});

describe("enseignements", () => {
  it("en exige de 3 à 5", () => {
    const learning = { observation: "x", nb_videos: 2, confiance: "faible" as const, decision: "y" };
    expect(check({ enseignements: [learning, learning] }).join()).toMatch(/2 enseignement\(s\)/);
  });

  it("refuse nb_videos à 0 ou supérieur au nombre de vidéos comparables", () => {
    const base = makeReport().enseignements;
    expect(check({ enseignements: [...base.slice(0, 2), { observation: "o", nb_videos: 0, confiance: "faible", decision: "d" }] }).join()).toMatch(/nb_videos/);
    expect(check({ enseignements: [...base.slice(0, 2), { observation: "o", nb_videos: 9, confiance: "forte", decision: "d" }] }).join()).toMatch(/entre 1 et 4/);
  });
});

describe("chiffres cités", () => {
  it("lit les pourcentages d'un texte", () => {
    expect(extractPercents("+15 %, -60% et 12,5 % mais pas 70 s")).toEqual([15, 60, 12.5]);
  });

  it("accepte un pourcentage calculé en code, à 1 point près", () => {
    expect(checkCitedPercents(makeReport({ resume: "Vues +101 % pour la meilleure" }), snapshot.allowedPercents).ok).toBe(true);
  });

  it("refuse un pourcentage absent des données (calculé ou inventé par le modèle)", () => {
    const reasons = check({ enseignements: [...makeReport().enseignements.slice(0, 2), { observation: "Les questions font +33 % de vues", nb_videos: 3, confiance: "faible", decision: "d" }] });
    expect(reasons.join()).toMatch(/33 %/);
  });
});

describe("expériences", () => {
  const running: RunningExperiment[] = [{ hypothesis: "h", variable: "Créneau", successCriterion: "+10 %", startedAt: null }];

  it("en exige exactement 2", () => {
    expect(check({ experiences: [makeReport().experiences[0] ?? { hypothese: "", variable: "", critere_reussite: "" }] }).join()).toMatch(/exactement 2/);
  });

  it("refuse plusieurs variables dans une expérience", () => {
    expect(isSingleVariable("durée")).toBe(true);
    expect(isSingleVariable("type d'accroche")).toBe(true);
    expect(isSingleVariable("durée et musique")).toBe(false);
    expect(isSingleVariable("durée + musique")).toBe(false);
    expect(isSingleVariable("durée, musique")).toBe(false);
  });

  it("refuse un critère de réussite non chiffré", () => {
    const [first, second] = makeReport().experiences;
    if (!first || !second) throw new Error("fixture");
    expect(failures(checkExperiments(makeReport({ experiences: [{ ...first, critere_reussite: "mieux qu'avant" }, second] }), [])).join()).toMatch(/chiffré/);
  });

  it("refuse une variable déjà testée par une expérience en cours, ou deux fois la même", () => {
    expect(failures(checkExperiments(makeReport(), running)).join()).toMatch(/déjà testée/);
    const [first] = makeReport().experiences;
    if (!first) throw new Error("fixture");
    expect(failures(checkExperiments(makeReport({ experiences: [first, { ...first, hypothese: "autre" }] }), [])).join()).toMatch(/même variable/);
  });
});

describe("résumé, bible et justification", () => {
  it("refuse un résumé de plus de 3 lignes ou vide", () => {
    expect(check({ resume: "a\nb\nc\nd" }).join()).toMatch(/4 lignes/);
    expect(check({ resume: "  " }).join()).toMatch(/vide/);
  });

  it("limite les mises à jour de la bible", () => {
    expect(check({ maj_bible: ["a", "b", "c", "d", "e", "f"] }).join()).toMatch(/5 lignes au maximum/);
    expect(check({ maj_bible: ["x".repeat(301)] }).join()).toMatch(/300 caractères/);
  });

  it("refuse une justification vide", () => {
    expect(check({ justification: "" }).join()).toMatch(/justification/);
  });
});
