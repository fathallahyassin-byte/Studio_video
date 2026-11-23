import { describe, expect, it } from "vitest";
import { hoursBefore, makeVideo, NOW, SAMPLES, VIDEOS } from "./fixtures";
import { dominantVisual, durationBucket, readVideoMeta } from "./metadata";
import { latestVersionPerAgent } from "./ports";
import { buildSnapshot, hasComparableVideos } from "./snapshot";
import { formatCriterion, formatExperiments, formatMetadata, formatStats, NO_CRITERION, NO_EXPERIMENTS } from "./variables";

const snapshot = buildSnapshot({ now: NOW, samples: SAMPLES, videos: VIDEOS });

describe("snapshot", () => {
  it("regroupe par pilier avec l'indice médian, calculé en code", () => {
    const pillars = snapshot.groups.filter((group) => group.dimension === "pilier");
    expect(pillars.map((group) => [group.value, group.count, group.gapPct])).toEqual([
      ["Salle de bain", 2, 30],
      ["Cuisine", 2, -20],
    ]);
  });

  it("liste les pourcentages citables : taux, médianes, écarts", () => {
    expect(snapshot.allowedPercents).toEqual(expect.arrayContaining([0, 15, 20, 30, 36, 40, 44, 50, 55, 60, 75, 90, 100]));
    expect(snapshot.allowedPercents).not.toContain(33);
  });

  it("n'a rien à comparer sans vidéo de plus de 72 h", () => {
    expect(hasComparableVideos(buildSnapshot({ now: NOW, samples: SAMPLES.slice(4), videos: VIDEOS }))).toBe(false);
    expect(hasComparableVideos(snapshot)).toBe(true);
  });
});

describe("formatStats", () => {
  const text = formatStats(snapshot);

  it("annonce la fenêtre, la règle des 72 h et la taille du top et du flop", () => {
    expect(text).toContain("Période 2026-W48 : publications du 2026-10-26 au 2026-11-23 (28 jours)");
    expect(text).toContain("plus de 72 h");
    expect(text).toContain("Top attendu : 2 vidéo(s), flop attendu : 2");
  });

  it("classe les vidéos comparables et garde la vidéo récente comme biais, sans écart", () => {
    const data: unknown = JSON.parse(text.slice(text.indexOf("{")));
    expect(data).toMatchObject({
      classement: [{ rang: 1, video_id: "v-a", ecart_mediane_pct: 75 }, { video_id: "v-b" }, { video_id: "v-c" }, { video_id: "v-d", ecart_mediane_pct: -55 }],
      mediane_par_plateforme: [{ plateforme: "TIKTOK", nb_publications: 4, vues: 10_000, pct_visionnage_complet: 40 }],
      colonnes_absentes: ["retention_3s", "commentaires", "part_trafic_recherche"],
    });
    expect(text).toMatch(/"video_id": "v-new",[\s\S]*?"exclue": "publiée il y a moins de 72 h"[\s\S]*?"ecart_mediane_pct": null/);
  });
});

describe("métadonnées", () => {
  it("lit pilier, format, accroche, durée, visuel, créneau et versions de prompt", () => {
    const meta = readVideoMeta(makeVideo("v-a", 31));
    expect(meta).toMatchObject({ label: "V-031", pillar: "Salle de bain", format: "révélation", hookType: "question", hookText: "Pourquoi ?", durationS: 68, visual: "image_ia_animee" });
    expect(meta.slots[0]?.label).toMatch(/^[a-z]+ \d{1,2} h$/);
    expect(formatMetadata([meta])).toContain('"agent 2 v1",\n      "agent 4 v2"');
  });

  it("tolère une vidéo ajoutée à la main (ni pilier ni script)", () => {
    const meta = readVideoMeta(makeVideo("v-h", 9, { idea: { angle: "x", source: "humain" }, script: null, storyboard: null, timeline: null, publications: [{ platform: "YOUTUBE", publishedAt: null }] }));
    expect(meta).toMatchObject({ pillar: null, format: null, hookType: null, hookText: null, durationS: null, visual: null, slots: [{ platform: "YOUTUBE", label: null }] });
  });

  it("prend la durée estimée du script sans timeline, et range les durées par 15 s", () => {
    expect(readVideoMeta(makeVideo("v", 1, { timeline: null })).durationS).toBe(70);
    expect([durationBucket(59.9), durationBucket(60), durationBucket(89)]).toEqual(["45–60 s", "60–75 s", "75–90 s"]);
    expect(dominantVisual({ plans: [] })).toBeNull();
  });

  it("garde la version de prompt de la dernière exécution réussie de chaque agent", () => {
    const runs = [
      { agentId: 4, promptVersion: { version: 3 } },
      { agentId: 2, promptVersion: { version: 1 } },
      { agentId: 4, promptVersion: { version: 2 } },
    ];
    expect(latestVersionPerAgent(runs)).toEqual([
      { agentId: 4, version: 3 },
      { agentId: 2, version: 1 },
    ]);
  });
});

describe("expériences et critère", () => {
  it("dit explicitement quand il n'y a rien", () => {
    expect(formatExperiments([])).toBe(NO_EXPERIMENTS);
    expect(formatCriterion(null)).toBe(NO_CRITERION);
    expect(formatCriterion("10 vidéos")).toBe("10 vidéos");
  });

  it("liste les expériences en cours avec leur date de lancement", () => {
    const text = formatExperiments([{ hypothesis: "h", variable: "durée", successCriterion: "+5 points", startedAt: hoursBefore(48) }]);
    expect(JSON.parse(text)).toEqual([{ hypothese: "h", variable: "durée", critere_reussite: "+5 points", lancee_le: "2026-11-21" }]);
  });
});
