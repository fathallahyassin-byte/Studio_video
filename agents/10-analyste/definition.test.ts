import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createAnalystDefinition, definition, NotEnoughDataError, recordReport } from "./definition";
import { makeReport, makeSample, NOW, SAMPLES, TEST_BIBLE, VIDEOS } from "./fixtures";
import type { AnalysisPorts, NewReport, PeriodData } from "./ports";
import type { PublicationSample } from "./stats";
import { NO_CRITERION, NO_EXPERIMENTS, type RunningExperiment } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const CHANNEL_ID = "chaine-1";
const JOB_KEY = `analyse:${CHANNEL_ID}:2026-W48`;

type FakeOptions = { samples?: PublicationSample[]; running?: RunningExperiment[]; now?: Date };

/** Base en mémoire : rapports uniques par AgentRun, expériences créées avec le rapport. */
function makePorts(runIdOf: () => string | null, options: FakeOptions = {}) {
  const reports: NewReport[] = [];
  const periodCalls: { since: Date; now: Date }[] = [];
  const ports: AnalysisPorts = {
    now: () => options.now ?? new Date(NOW.getTime() + 25 * 60_000),
    async loadPeriod(_channelId, since, now): Promise<PeriodData> {
      periodCalls.push({ since, now });
      return { samples: options.samples ?? SAMPLES, videos: VIDEOS };
    },
    async loadRunningExperiments() {
      return options.running ?? [];
    },
    async findSucceededRunId() {
      return runIdOf();
    },
    async saveReport(report) {
      if (reports.some((existing) => existing.agentRunId === report.agentRunId)) return "exists";
      reports.push(report);
      return "created";
    },
  };
  return { ports, reports, periodCalls };
}

function makeLlm(answers: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "faux",
    requests,
    async complete(request) {
      requests.push(request);
      const text = answers.shift();
      if (text === undefined) throw new Error("plus de réponse prévue");
      return { text, inputTokens: 4000, outputTokens: 1200, cost: 0.07 };
    },
  };
}

function setup(answers: string[], options: FakeOptions & { bible?: string } = {}) {
  const store = createMemoryRunStore();
  store.setAgent({ id: 10, slug: "10-analyste", name: "Analyste", model: "modele-test", active: true, promptVersion: { id: "pv-10", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-3", content: options.bible ?? TEST_BIBLE });
  const fake = makePorts(() => store.runs.find((run) => run.jobKey === JOB_KEY && run.status === "OK")?.id ?? null, options);
  const analyst = createAnalystDefinition(() => fake.ports);
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: null, note: null, payload: null };
  const run = () => runAgent({ definition: analyst, input, channelId: CHANNEL_ID, videoId: null, jobKey: JOB_KEY }, { store, llm, notifier });
  return { ...fake, analyst, store, llm, sent, input, run };
}

const json = (value: unknown) => JSON.stringify(value);

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 10, slug: "10-analyste", name: "Analyste", promptFile: "prompt.md" });
  });
});

describe("analyste avec runAgent (faux LLM)", () => {
  it("sortie valide : variables remplies, AgentRun complet, rapport et 2 expériences enregistrés", async () => {
    const ctx = setup([json(makeReport())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('"video_id": "v-a"');
    expect(system).toContain("Top attendu : 2 vidéo(s), flop attendu : 2");
    expect(system).toContain("publiée il y a moins de 72 h");
    expect(system).toContain('"pilier": "Cuisine"');
    expect(system).toContain("agent 4 v2");
    expect(system).toContain(NO_EXPERIMENTS);
    expect(system).toContain("10 vidéos à plus de 35 % de visionnage complet");

    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 10,
      videoId: null,
      promptVersionId: "pv-10",
      bibleVersionId: "bible-3",
      inputTokens: 4000,
      outputTokens: 1200,
      cost: 0.07,
      input: { STATS: expect.stringContaining("mediane_par_plateforme"), METADONNEES: expect.stringContaining("V-001"), EXPERIENCES: NO_EXPERIMENTS },
    });
    expect(ctx.reports).toHaveLength(1);
    expect(ctx.reports[0]).toMatchObject({ channelId: CHANNEL_ID, agentRunId: ctx.store.runs[0]?.id, period: "2026-W48" });
    expect(ctx.reports[0]?.content.experiences).toHaveLength(2);
    expect(ctx.reports[0]?.content.enseignements[0]?.confiance).toBe("faible");
  });

  it("lit les stats à l'heure pleine sur 28 jours", async () => {
    const ctx = setup([json(makeReport())]);
    await ctx.run();
    expect(ctx.periodCalls[0]).toEqual({ since: new Date("2026-10-26T06:00:00Z"), now: NOW });
  });

  it("dit au modèle quand la bible n'a pas de critère de niche", async () => {
    const ctx = setup([json(makeReport())], { bible: TEST_BIBLE.replace("10 vidéos à plus de 35 % de visionnage complet", "{{CRITERE}}") });
    await ctx.run();
    expect(ctx.llm.requests[0]?.system).toContain(NO_CRITERION);
  });

  it("liste les expériences en cours", async () => {
    const running = [{ hypothesis: "Les questions accrochent", variable: "type d'accroche", successCriterion: "+5 points", startedAt: new Date("2026-11-16T08:00:00Z") }];
    const ctx = setup([json(makeReport())], { running });
    await ctx.run();
    expect(ctx.llm.requests[0]?.system).toContain('"lancee_le": "2026-11-16"');
  });

  it("contrôle refusé puis corrigé : relance avec le motif, un seul rapport", async () => {
    const bad = makeReport({ top: [{ video_id: "v-new", pourquoi: "explose" }, { video_id: "v-a", pourquoi: "" }] });
    const ctx = setup([json(bad), json(makeReport())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toMatch(/v-new exclue/);
    expect(ctx.reports).toHaveLength(1);
  });

  it("sortie invalide 3 fois : needs_fix, alerte vers la page de l'agent, aucun rapport", async () => {
    const ctx = setup(["pas du JSON", json({ periode: "x" }), json({ ...makeReport(), verdict_niche: "foncer" })]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "INVALID_JSON"]);
    expect(ctx.store.needsFix.size).toBe(0);
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed", path: "/agents/10-analyste" })]);
    expect(ctx.reports).toHaveLength(0);
  });
});

describe("pas assez de données", () => {
  it("sans aucune statistique : erreur de précondition, le modèle n'est pas appelé", async () => {
    const ctx = setup([json(makeReport())], { samples: [] });
    await expect(ctx.run()).rejects.toBeInstanceOf(NotEnoughDataError);
    expect(ctx.llm.requests).toHaveLength(0);
    expect(ctx.store.runs).toHaveLength(0);
  });

  it("seulement des vidéos de moins de 72 h ou sans relevé : même refus", async () => {
    const ctx = setup([json(makeReport())], { samples: [makeSample("v-new", "TIKTOK", 70), makeSample("v-a", "TIKTOK", 200, null)] });
    const error = await ctx.run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentPreconditionError);
    expect(String(error)).toMatch(/72 h/);
    expect(ctx.llm.requests).toHaveLength(0);
  });
});

describe("onSuccess idempotent", () => {
  it("rejoué après un crash, il ne recrée ni rapport ni expériences", async () => {
    const ctx = setup([json(makeReport())]);
    await ctx.run();
    const output = ctx.analyst.outputSchema.parse(ctx.store.runs[0]?.output);
    await expect(recordReport(ctx.ports, ctx.input, output)).resolves.toBe("exists");
    await ctx.analyst.onSuccess(output, ctx.input, { channelId: CHANNEL_ID, videoId: null, bible: TEST_BIBLE, bibleVersionId: "bible-3" });
    expect(ctx.reports).toHaveLength(1);
  });

  it("une reprise de la même tâche ne rappelle pas le modèle et rejoue seulement onSuccess inachevé", async () => {
    const ctx = setup([json(makeReport())]);
    await ctx.run();
    const run = ctx.store.runs[0];
    if (!run) throw new Error("run attendu");
    run.successHandledAt = null;
    const again = await ctx.run();
    expect(again).toMatchObject({ status: "ok", reused: true });
    expect(ctx.llm.requests).toHaveLength(1);
    expect(ctx.reports).toHaveLength(1);
  });

  it("refuse d'écrire un rapport sans AgentRun réussi", async () => {
    const { ports } = makePorts(() => null);
    const input: AgentJobInput = { jobId: "job-x", channelId: CHANNEL_ID, videoId: null, note: null, payload: null };
    await expect(recordReport(ports, input, makeReport())).rejects.toThrow(/introuvable/);
  });
});
