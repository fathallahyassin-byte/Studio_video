import { describe, expect, it } from "vitest";
import { applyReportToBible, closeExperiment, launchAnalysis, launchExperiment, pickLearnings, type AnalysisJob, type HumanPorts } from "./actionsLogic";
import { readLearnings } from "./bibleText";
import { makeReport, NOW, TEST_BIBLE } from "./fixtures";

const CHANNEL_ID = "chaine-1";

type Version = { readonly id: string; readonly version: number; readonly content: string; readonly author: string };
type ExperimentState = { id: string; status: "PROPOSED" | "RUNNING" | "DONE" };

/** Base en mémoire : les versions de bible sont gelées, comme les triggers SQL qui interdisent de les modifier. */
function makeHumanPorts(options: { bible?: string | null; job?: AnalysisJob | null; weeklyQueued?: boolean } = {}) {
  const versions: Version[] = options.bible === null ? [] : [Object.freeze({ id: "bv-1", version: 1, content: options.bible ?? TEST_BIBLE, author: "HUMAN" })];
  const state = { activeId: versions[0]?.id ?? null, applied: null as string | null, reruns: 0 };
  const report = { id: "rapport-1", channelId: CHANNEL_ID, period: "2026-W48", content: makeReport({ maj_bible: ["Les questions accrochent", "Viser 70 s"] }) };
  const experiments: ExperimentState[] = [{ id: "xp-1", status: "PROPOSED" }];
  const versionOf = (id: string | null) => versions.find((entry) => entry.id === id)?.version ?? null;

  const ports: HumanPorts = {
    async loadReport(reportId) {
      return reportId === report.id ? { ...report, appliedVersion: versionOf(state.applied) } : null;
    },
    async loadActiveBible() {
      return versions.find((entry) => entry.id === state.activeId) ?? null;
    },
    async createBibleFromReport(input) {
      if (state.applied !== null) return { status: "already_applied", version: versionOf(state.applied) };
      const created = Object.freeze({ id: `bv-${versions.length + 1}`, version: versions.length + 1, content: input.content, author: "AGENT_10" });
      versions.push(created);
      state.applied = created.id;
      state.activeId = created.id;
      return { status: "created", version: created.version };
    },
    async startExperiment(experimentId) {
      return transition(experiments, experimentId, "PROPOSED", "RUNNING");
    },
    async finishExperiment(experimentId) {
      return transition(experiments, experimentId, "RUNNING", "DONE");
    },
    async queueWeeklyAnalysis() {
      return { queued: options.weeklyQueued ?? false, week: "2026-W48" };
    },
    async loadWeekJob() {
      return options.job ?? null;
    },
    async queueRerun() {
      state.reruns += 1;
      return state.reruns === 1;
    },
  };
  return { ports, versions, state, experiments };
}

function transition(experiments: ExperimentState[], id: string, from: ExperimentState["status"], to: ExperimentState["status"]): boolean {
  const experiment = experiments.find((entry) => entry.id === id && entry.status === from);
  if (!experiment) return false;
  experiment.status = to;
  return true;
}

const apply = (ports: HumanPorts, selected: number[] = [0, 1]) => applyReportToBible(ports, { reportId: "rapport-1", channelId: CHANNEL_ID, selected });

describe("Appliquer à la bible", () => {
  it("crée une nouvelle version (agent 10), l'adopte et ne modifie pas l'ancienne", async () => {
    const fake = makeHumanPorts();
    const before = fake.versions[0];
    const result = await apply(fake.ports);

    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Bible v2 créée avec 2 apprentissage(s)") });
    expect(fake.versions).toHaveLength(2);
    expect(fake.versions[0]).toBe(before);
    expect(fake.versions[0]?.content).toBe(TEST_BIBLE);
    expect(fake.versions[1]).toMatchObject({ version: 2, author: "AGENT_10" });
    expect(readLearnings(fake.versions[1]?.content ?? "")).toEqual(["[2026-W48] Les questions accrochent", "[2026-W48] Viser 70 s"]);
    expect(fake.state.activeId).toBe("bv-2");
  });

  it("double clic : une seule version créée", async () => {
    const fake = makeHumanPorts();
    const [first, second] = await Promise.all([apply(fake.ports), apply(fake.ports)]);
    const third = await apply(fake.ports);

    expect(fake.versions).toHaveLength(2);
    expect([first, second].filter((result) => result.message.startsWith("Bible v2 créée"))).toHaveLength(1);
    expect(third).toEqual({ ok: true, message: "Déjà appliqué : bible v2." });
  });

  it("n'ajoute que les lignes cochées", async () => {
    const fake = makeHumanPorts();
    await apply(fake.ports, [1, 7]);
    expect(readLearnings(fake.versions[1]?.content ?? "")).toEqual(["[2026-W48] Viser 70 s"]);
  });

  it("refuse sans ligne cochée, sans bible active ou pour un rapport d'une autre chaîne", async () => {
    expect(await apply(makeHumanPorts().ports, [])).toMatchObject({ ok: false, message: expect.stringMatching(/Coche/) });
    expect(await apply(makeHumanPorts({ bible: null }).ports)).toMatchObject({ ok: false, message: expect.stringMatching(/Aucune bible active/) });
    const other = await applyReportToBible(makeHumanPorts().ports, { reportId: "rapport-1", channelId: "autre", selected: [0] });
    expect(other).toMatchObject({ ok: false, message: "Rapport introuvable." });
  });

  it("ne crée pas de version quand les lignes sont déjà dans la bible", async () => {
    const fake = makeHumanPorts({ bible: TEST_BIBLE.replace(`"aucun pour l'instant"`, `"[2026-W47] Les questions accrochent"\n  - "Viser 70 s"`) });
    expect(await apply(fake.ports)).toMatchObject({ ok: false, message: expect.stringMatching(/déjà dans la bible v1/) });
    expect(fake.versions).toHaveLength(1);
  });

  it("refuse une bible active illisible sans rien créer", async () => {
    const fake = makeHumanPorts({ bible: "chaine: [\n" });
    expect(await apply(fake.ports)).toMatchObject({ ok: false, message: expect.stringMatching(/YAML/) });
    expect(fake.versions).toHaveLength(1);
  });

  it("pickLearnings ignore les indices hors liste et un contenu illisible", () => {
    expect(pickLearnings(makeReport({ maj_bible: ["a", "b"] }), [3, 1, 1])).toEqual(["b"]);
    expect(pickLearnings({ autre: true }, [0])).toEqual([]);
  });
});

describe("expériences", () => {
  it("« Lancer » passe une expérience proposée en cours, une seule fois", async () => {
    const fake = makeHumanPorts();
    const input = { experimentId: "xp-1", channelId: CHANNEL_ID, now: NOW };
    expect(await launchExperiment(fake.ports, input)).toEqual({ ok: true, message: "Expérience lancée." });
    expect(fake.experiments[0]?.status).toBe("RUNNING");
    expect((await launchExperiment(fake.ports, input)).ok).toBe(false);
  });

  it("« Clore » termine une expérience en cours seulement", async () => {
    const fake = makeHumanPorts();
    const input = { experimentId: "xp-1", channelId: CHANNEL_ID, now: NOW };
    expect((await closeExperiment(fake.ports, input)).ok).toBe(false);
    await launchExperiment(fake.ports, input);
    expect(await closeExperiment(fake.ports, input)).toEqual({ ok: true, message: "Expérience close." });
    expect(fake.experiments[0]?.status).toBe("DONE");
  });
});

describe("Lancer l'analyse", () => {
  const input = { channelId: CHANNEL_ID, now: NOW };

  it("met en file l'analyse de la semaine (requestAnalysis)", async () => {
    const result = await launchAnalysis(makeHumanPorts({ weeklyQueued: true }).ports, input);
    expect(result).toEqual({ ok: true, message: "Analyse 2026-W48 en file : le worker la lance dans la minute." });
  });

  it("ne double pas une analyse en file ; montre pourquoi elle attend", async () => {
    const fake = makeHumanPorts({ job: { status: "QUEUED", lastError: "Pas encore de statistiques à analyser", runAfter: NOW } });
    const result = await launchAnalysis(fake.ports, input);
    expect(result.message).toMatch(/en attente .*Pas encore de statistiques/);
    expect(fake.state.reruns).toBe(0);
  });

  it("relance une analyse terminée, une seule fois à la fois", async () => {
    const fake = makeHumanPorts({ job: { status: "DONE", lastError: null, runAfter: NOW } });
    expect(await launchAnalysis(fake.ports, input)).toEqual({ ok: true, message: "Nouvelle analyse 2026-W48 en file." });
    expect((await launchAnalysis(fake.ports, input)).ok).toBe(false);
  });
});
