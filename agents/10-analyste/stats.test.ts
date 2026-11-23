import { describe, expect, it } from "vitest";
import { hoursBefore, makeSample, NOW, SAMPLES } from "./fixtures";
import { exclusionOf, expectedRanking, median, platformMedians, rankVideos, ratioToMedian, referenceTime, rowIndex, scoreRows, windowStart } from "./stats";

describe("median", () => {
  it("renvoie null sans valeur, la valeur du milieu sinon (liste non triée)", () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([9, 1, 5])).toBe(5);
  });

  it("fait la moyenne des deux valeurs centrales pour un nombre pair", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([0.44, 0.36])).toBeCloseTo(0.4);
  });

  it("ne modifie pas la liste reçue", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("exclusion des vidéos de moins de 72 h", () => {
  it("garde une publication d'exactement 72 h et exclut celle de 71 h 59", () => {
    expect(exclusionOf({ ...makeSample("v", "TIKTOK", 72) }, NOW)).toBeNull();
    const justBefore = { ...makeSample("v", "TIKTOK", 0), publishedAt: new Date(hoursBefore(72).getTime() + 60_000) };
    expect(exclusionOf(justBefore, NOW)).toBe("moins_de_72h");
  });

  it("exclut une publication sans date ou sans relevé", () => {
    expect(exclusionOf(makeSample("v", "TIKTOK", null), NOW)).toBe("date_inconnue");
    expect(exclusionOf(makeSample("v", "TIKTOK", 100, null), NOW)).toBe("aucun_releve");
  });

  it("calcule les médianes sans la vidéo récente, même si ses chiffres sont énormes", () => {
    const [tiktok] = platformMedians(SAMPLES, NOW);
    expect(tiktok).toMatchObject({ platform: "TIKTOK", publications: 4 });
    expect(tiktok?.values.views).toBe(10_000);
    expect(tiktok?.values.completionRate).toBeCloseTo(0.4);
  });

  it("ne classe pas la vidéo récente et ne lui donne aucun écart", () => {
    const rows = scoreRows(SAMPLES, NOW);
    const recent = rows.find((row) => row.sample.videoId === "v-new");
    expect(recent).toMatchObject({ exclusion: "moins_de_72h", index: null });
    expect(recent?.gaps.views).toBeNull();
    expect(rankVideos(rows).map((score) => score.videoId)).toEqual(["v-a", "v-b", "v-c", "v-d"]);
  });
});

describe("médianes par plateforme", () => {
  it("compare chaque publication à la médiane de SA plateforme", () => {
    const samples = [
      makeSample("v-1", "TIKTOK", 100, { views: 1_000 }),
      makeSample("v-1", "YOUTUBE", 100, { views: 100 }),
      makeSample("v-2", "TIKTOK", 100, { views: 3_000 }),
      makeSample("v-2", "YOUTUBE", 100, { views: 300 }),
    ];
    const medians = platformMedians(samples, NOW);
    expect(medians.map((entry) => [entry.platform, entry.values.views])).toEqual([
      ["TIKTOK", 2_000],
      ["YOUTUBE", 200],
    ]);
    const gaps = scoreRows(samples, NOW).map((row) => row.gaps.views);
    expect(gaps).toEqual([-50, -50, 50, 50]);
  });

  it("donne un écart null quand la médiane vaut 0 (aucune comparaison possible)", () => {
    expect(ratioToMedian(10, 0)).toBeNull();
    const rows = scoreRows([makeSample("v-1", "YOUTUBE", 100, { saves: 0 }), makeSample("v-2", "YOUTUBE", 100, { saves: 0 })], NOW);
    expect(rows[0]?.gaps.saves).toBeNull();
    expect(rows[0]?.gaps.views).toBe(0);
  });

  it("calcule les écarts en pourcentage arrondi", () => {
    const rows = scoreRows(SAMPLES, NOW);
    const first = rows.find((row) => row.sample.videoId === "v-a");
    expect(first?.gaps).toMatchObject({ views: 100, completionRate: 50, shares: 0 });
    expect(first?.index).toBeCloseTo(1.75);
  });
});

describe("indices et classement", () => {
  it("indice = moyenne des rapports disponibles, 1 sans rapport", () => {
    expect(rowIndex(2, 1)).toBe(1.5);
    expect(rowIndex(null, 0.5)).toBe(0.5);
    expect(rowIndex(null, null)).toBe(1);
  });

  it("une vidéo sur deux plateformes prend la moyenne de ses deux indices", () => {
    const samples = [
      makeSample("v-1", "TIKTOK", 100, { views: 2_000, completionRate: 0.4 }),
      makeSample("v-1", "YOUTUBE", 100, { views: 100, completionRate: 0.4 }),
      makeSample("v-2", "TIKTOK", 100, { views: 1_000, completionRate: 0.4 }),
      makeSample("v-2", "YOUTUBE", 100, { views: 300, completionRate: 0.4 }),
    ];
    const ranking = rankVideos(scoreRows(samples, NOW));
    expect(ranking[0]).toMatchObject({ videoId: "v-2", platforms: ["TIKTOK", "YOUTUBE"] });
    expect(ranking.map((score) => score.gapPct)).toEqual([4, -4]);
  });

  it("répartit top et flop sans compter une vidéo deux fois", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(expectedRanking)).toEqual([
      { top: 0, flop: 0 },
      { top: 1, flop: 0 },
      { top: 1, flop: 1 },
      { top: 2, flop: 1 },
      { top: 2, flop: 2 },
      { top: 3, flop: 2 },
      { top: 3, flop: 3 },
      { top: 3, flop: 3 },
    ]);
  });
});

describe("fenêtre", () => {
  it("couvre les 28 derniers jours et part de l'heure pleine", () => {
    expect(windowStart(NOW).toISOString()).toBe("2026-10-26T06:00:00.000Z");
    expect(referenceTime(new Date("2026-11-23T06:42:10Z")).toISOString()).toBe("2026-11-23T06:00:00.000Z");
  });
});
