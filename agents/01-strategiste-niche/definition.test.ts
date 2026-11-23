import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createStrategyDefinition, definition } from "./definition";
import { draftNote, recordDraft } from "./draft";
import { BIBLE_TEMPLATE, fillTemplate, makeOutput, PAYLOAD } from "./fixtures";
import { outputSchema } from "./schema";
import { createWorld, fakeStrategyPorts, snapshotVersions, type FakeWorld } from "./testing";
import { NO_PISTES } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const CHANNEL_ID = "chaine-1";
const json = (value: unknown) => JSON.stringify(value);

function makeLlm(answers: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "faux",
    requests,
    async complete(request) {
      requests.push(request);
      const text = answers.shift();
      if (text === undefined) throw new Error("plus de réponse prévue");
      return { text, inputTokens: 9000, outputTokens: 6000, cost: 0.2 };
    },
  };
}

type SetupOptions = { payload?: unknown; world?: FakeWorld; activeBible?: { id: string; content: string } };

function setup(answers: string[], options: SetupOptions = {}) {
  const world = options.world ?? createWorld();
  const strategyDefinition = createStrategyDefinition(() => fakeStrategyPorts(world));
  const store = createMemoryRunStore();
  store.setAgent({ id: 1, slug: "01-strategiste-niche", name: "Stratège de niche", model: "modele-test", active: true, promptVersion: { id: "pv-1", content: PROMPT } });
  if (options.activeBible) store.setActiveBible(CHANNEL_ID, options.activeBible);
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: null, note: null, payload: options.payload === undefined ? PAYLOAD : options.payload };
  const run = () => runAgent({ definition: strategyDefinition, input, channelId: CHANNEL_ID, videoId: null, jobKey: "strategie:chaine-1:2026-11-23:abc" }, { store, llm, notifier });
  return { world, strategyDefinition, store, llm, sent, input, run };
}

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 1, slug: "01-strategiste-niche", name: "Stratège de niche", promptFile: "prompt.md" });
  });
});

describe("stratège de niche avec runAgent (faux LLM)", () => {
  it("sortie valide sans bible : variables remplies, AgentRun complet, un brouillon non actif créé", async () => {
    const ctx = setup([json(makeOutput())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).toContain("- histoire des objets");
    expect(system).toContain("6 h par semaine");
    expect(system).toContain("500 € par mois dans 12 mois");
    expect(system).toContain('nom: "{{NOM}}"'); // le modèle est injecté tel quel, sans seconde passe
    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 1,
      videoId: null,
      promptVersionId: "pv-1",
      bibleVersionId: null,
      inputTokens: 9000,
      outputTokens: 6000,
      cost: 0.2,
      input: { PISTES_NICHES: expect.stringContaining("inventions ratées"), MODELE_BIBLE: BIBLE_TEMPLATE },
    });
    expect(ctx.world.versions).toEqual([{ id: "bible-1", channelId: CHANNEL_ID, version: 1, content: fillTemplate(), author: "AGENT_1" }]);
    expect(ctx.world.notes.get("bible-1")).toBe(draftNote("Histoire cachée des objets", "job-1"));
    expect(ctx.world.activeBibleId).toBeNull();
    expect(ctx.sent).toEqual([]);
    expect(ctx.world.notified).toEqual([{ draft: { id: "bible-1", version: 1 }, niche: "Histoire cachée des objets" }]);
  });

  it("pistes vides : la variable le dit explicitement", async () => {
    const ctx = setup([json(makeOutput())], { payload: { ...PAYLOAD, pistes: [] } });
    await ctx.run();
    expect(ctx.llm.requests[0]?.system).toContain(NO_PISTES);
  });

  it("enregistre le score recalculé et le tri, pas le score du modèle", async () => {
    const ctx = setup([json(makeOutput())]);
    await ctx.run();
    const output = outputSchema.parse(ctx.store.runs[0]?.output);
    expect(output.candidates[0]).toMatchObject({ niche: "Histoire cachée des objets", score_pondere: 52.5 });
    expect(output.candidates.map((entry) => entry.score_pondere)).not.toContain(99);
  });

  it("note hors bornes : refusée par le schéma puis corrigée", async () => {
    const bad = makeOutput();
    const first = bad.candidates[0];
    if (!first) throw new Error("fixture vide");
    const outOfBounds = { ...bad, candidates: [{ ...first, criteres: { ...first.criteres, demande: { note: 6, pourquoi: "trop" } } }, ...bad.candidates.slice(1)] };
    const ctx = setup([json(outOfBounds), json(makeOutput())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "OK"]);
    expect(ctx.store.runs[0]?.error).toContain("demande");
  });

  it("sortie invalide trois fois : 3 AgentRun, échec signalé (NEEDS_FIX), aucun brouillon", async () => {
    const wrongPlan = makeOutput({ plan_de_test: { nb_videos: 10, semaines: 2, critere_validation: "bien" } });
    const ctx = setup(["pas du JSON", json({ ...makeOutput(), top3: [] }), json(wrongPlan)]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("20 vidéos en 4 semaines");
    expect(ctx.llm.requests[2]?.messages.at(-1)?.content).toContain("schéma");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed", path: "/agents/01-strategiste-niche" })]);
    expect(ctx.world.versions).toEqual([]);
  });

  it("contrôle refusé (bible du modèle non remplie) : renvoyé au modèle, puis correction acceptée", async () => {
    const ctx = setup([json(makeOutput({ bible: BIBLE_TEMPLATE })), json(makeOutput())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("{{NOM}}");
    expect(ctx.world.versions).toHaveLength(1);
  });

  it("payload invalide : AgentPreconditionError, aucun appel, aucun AgentRun", async () => {
    const ctx = setup([json(makeOutput())], { payload: { ...PAYLOAD, heuresParSemaine: "beaucoup" } });
    await expect(ctx.run()).rejects.toBeInstanceOf(AgentPreconditionError);
    expect(ctx.llm.requests).toEqual([]);
    expect(ctx.store.runs).toEqual([]);
  });

  it("reprise après un crash avant la fin d'onSuccess : aucun nouvel appel, un seul brouillon", async () => {
    const ctx = setup([json(makeOutput())]);
    await ctx.run();
    const run = ctx.store.runs[0];
    if (!run) throw new Error("aucun run");
    run.successHandledAt = null; // onSuccess « interrompu » : runAgent le rejoue
    const replay = await ctx.run();
    expect(replay).toMatchObject({ status: "ok", reused: true });
    expect(ctx.llm.requests).toHaveLength(1);
    expect(ctx.world.versions).toHaveLength(1);
    expect(ctx.world.notified).toHaveLength(1);
  });

  it("ne modifie aucune BibleVersion existante (bible active déjà en place)", async () => {
    const world = createWorld([
      { content: "ancienne bible", author: "HUMAN" },
      { content: fillTemplate({ NOM: "Active" }), author: "HUMAN", active: true },
    ]);
    const before = snapshotVersions(world);
    const ctx = setup([json(makeOutput())], { world, activeBible: { id: "bible-2", content: fillTemplate({ NOM: "Active" }) } });
    await ctx.run();
    expect(JSON.stringify(world.versions.slice(0, 2))).toBe(before);
    expect(world.versions).toHaveLength(3);
    expect(world.versions[2]).toMatchObject({ version: 3, author: "AGENT_1" });
    expect(world.activeBibleId).toBe("bible-2");
    expect(ctx.store.runs[0]?.bibleVersionId).toBe("bible-2");
  });
});

describe("onSuccess", () => {
  it("est idempotent : rappelé avec la même sortie, il ne crée pas de second brouillon", async () => {
    const world = createWorld();
    const ports = fakeStrategyPorts(world);
    const first = await recordDraft(ports, { channelId: CHANNEL_ID, jobId: "job-9", output: makeOutput() });
    const second = await recordDraft(ports, { channelId: CHANNEL_ID, jobId: "job-9", output: makeOutput() });
    expect(first).toEqual({ draft: { id: "bible-1", version: 1 }, created: true });
    expect(second).toEqual({ draft: { id: "bible-1", version: 1 }, created: false });
    expect(world.writes.create).toBe(1);
    expect(world.notified).toHaveLength(1);
  });

  it("une autre tâche crée son propre brouillon, au numéro suivant", async () => {
    const world = createWorld();
    const ports = fakeStrategyPorts(world);
    await recordDraft(ports, { channelId: CHANNEL_ID, jobId: "job-1", output: makeOutput() });
    const other = await recordDraft(ports, { channelId: CHANNEL_ID, jobId: "job-2", output: makeOutput() });
    expect(other).toEqual({ draft: { id: "bible-2", version: 2 }, created: true });
  });

  it("enregistre la bible avec des fins de ligne Unix", async () => {
    const world = createWorld();
    await recordDraft(fakeStrategyPorts(world), { channelId: CHANNEL_ID, jobId: "job-1", output: makeOutput({ bible: "a: 1\r\nb: 2\r\n" }) });
    expect(world.versions[0]?.content).toBe("a: 1\nb: 2\n");
  });
});
