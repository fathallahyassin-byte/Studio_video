import { describe, expect, it } from "vitest";
import { makeReport, NOW } from "../fixtures";
import { citedVideoIds } from "./loadAnalysis";
import { buildPanelView, buildStatus, visibleExperiments, type ExperimentRow, type PanelInput } from "./view";

const reportRow = { id: "rapport-1", period: "2026-W48", createdAt: NOW, content: makeReport(), appliedVersion: null };
const experiment = (overrides: Partial<ExperimentRow>): ExperimentRow => ({
  id: "xp",
  reportId: "rapport-1",
  hypothesis: "h",
  variable: "durée",
  successCriterion: "+5 points",
  status: "PROPOSED",
  startedAt: null,
  ...overrides,
});
const input = (overrides: Partial<PanelInput> = {}): PanelInput => ({ report: reportRow, videos: [], experiments: [], job: null, hasActiveBible: true, ...overrides });

describe("buildPanelView", () => {
  it("sans rapport : vue vide, pas d'erreur", () => {
    expect(buildPanelView(input({ report: null }))).toMatchObject({ report: null, unreadableReport: false, experiments: [], status: null });
  });

  it("rapport illisible : signalé, sans planter", () => {
    expect(buildPanelView(input({ report: { ...reportRow, content: { periode: 1 } } }))).toMatchObject({ report: null, unreadableReport: true });
  });

  it("nomme les vidéos du top et du flop par leur numéro, ou les signale inconnues", () => {
    const view = buildPanelView(input({ videos: [{ id: "v-a", number: 31, title: "Le trombone" }] }));
    expect(view.report?.top.map((entry) => entry.label)).toEqual(["V-031 · Le trombone", "Vidéo inconnue (v-b)"]);
  });

  it("affiche chaque enseignement avec sa confiance et son nombre de vidéos", () => {
    const learning = buildPanelView(input()).report?.learnings[1];
    expect(learning).toMatchObject({ detail: "Confiance faible · 4 vidéos", tone: "run", decision: "Rester sous 75 s" });
  });

  it("donne le verdict, la version appliquée et le backlog non vide", () => {
    const report = buildPanelView(input({ report: { ...reportRow, appliedVersion: 4 } })).report;
    expect(report).toMatchObject({ verdictLabel: "Continuer", appliedVersion: 4, backlog: [{ label: "À prioriser", items: ["Le secret du trombone"] }] });
  });

  it("propose « Lancer » pour une expérience proposée et « Clore » pour une en cours", () => {
    const view = buildPanelView(input({ experiments: [experiment({ id: "a" }), experiment({ id: "b", status: "RUNNING", startedAt: NOW })] }));
    expect(view.experiments.map((entry) => [entry.id, entry.action])).toEqual([
      ["a", "launch"],
      ["b", "close"],
    ]);
    expect(view.experiments[1]?.statusLabel).toMatch(/^En cours depuis le /);
  });
});

describe("visibleExperiments", () => {
  it("garde les expériences du dernier rapport et toutes celles en cours", () => {
    const rows = [
      experiment({ id: "courant" }),
      experiment({ id: "ancien", reportId: "rapport-0" }),
      experiment({ id: "ancien-en-cours", reportId: "rapport-0", status: "RUNNING" }),
      experiment({ id: "close", status: "DONE" }),
    ];
    expect(visibleExperiments(rows, "rapport-1").map((row) => row.id)).toEqual(["courant", "ancien-en-cours", "close"]);
    expect(visibleExperiments(rows, null).map((row) => row.id)).toEqual(["ancien-en-cours"]);
  });
});

describe("buildStatus", () => {
  it("ne dit rien quand l'analyse de la semaine est faite", () => {
    expect(buildStatus(null)).toBeNull();
    expect(buildStatus({ status: "DONE", lastError: null, runAfter: NOW })).toBeNull();
  });

  it("met en jaune une analyse qui attend des données, a échoué ou n'a pas produit de rapport", () => {
    expect(buildStatus({ status: "QUEUED", lastError: "Pas encore de statistiques", runAfter: NOW })).toMatchObject({ waiting: true });
    expect(buildStatus({ status: "FAILED", lastError: "panne", runAfter: NOW })).toMatchObject({ waiting: true, message: expect.stringMatching(/panne/) });
    expect(buildStatus({ status: "DONE", lastError: "3 échecs : JSON", runAfter: NOW })).toMatchObject({ waiting: true });
    expect(buildStatus({ status: "RUNNING", lastError: null, runAfter: NOW })).toEqual({ message: "L'analyse de la semaine est en cours.", waiting: false });
  });
});

describe("citedVideoIds", () => {
  it("lit les video_id du top et du flop sans supposer un contenu valide", () => {
    expect(citedVideoIds(makeReport())).toEqual(["v-a", "v-b", "v-d", "v-c"]);
    expect(citedVideoIds({ top: [{ video_id: "x" }, { video_id: "x" }] })).toEqual(["x"]);
    expect(citedVideoIds(null)).toEqual([]);
  });
});
