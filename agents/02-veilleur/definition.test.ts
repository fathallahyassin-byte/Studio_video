import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { isoWeek } from "@/lib/pipeline/service";
import { createScoutDefinition, definition as registeredDefinition } from "./definition";
import { createFakeScoutStore, LEARNING, makeOutput, PILLARS, type FakeScoutStore } from "./testing";
import { NO_SIGNALS } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const NOW = new Date("2026-11-23T07:00:00Z");
const WEEK = isoWeek(NOW);
const BIBLE = [
  "chaine: { nom: Objets, niche: objets du quotidien, promesse: comprendre ses objets }",
  `ligne_editoriale: { ton: complice, piliers: [${PILLARS.map((pillar) => `"${pillar}"`).join(", ")}], sujets_interdits: ["conseil médical", "politique"] }`,
  "format_video: { duree_cible_s: [65, 90], debit_voix_mots_par_s: 2.6 }",
  "identite: { voix: tts / voix-1, cta: abonne-toi }",
].join("\n");

const VALID = JSON.stringify(makeOutput());
const INPUT: AgentJobInput = { jobId: "job-1", channelId: "chaine-1", videoId: null, note: null, payload: null };

function makeLlm(script: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "faux",
    requests,
    async complete(request) {
      requests.push(request);
      const text = script.shift();
      if (text === undefined) throw new Error("plus de réponse prévue");
      return { text, inputTokens: 1200, outputTokens: 3000, cost: 0.05 };
    },
  };
}

function setup(script: string[], scout: FakeScoutStore = createFakeScoutStore({ signals: "Tendance : objets vintage", learnings: [LEARNING], titles: ["Pourquoi les crayons sont jaunes"] })) {
  const runs = createMemoryRunStore();
  runs.setAgent({ id: 2, slug: "02-veilleur", name: "Veilleur", model: "modele-test", active: true, promptVersion: { id: "pv-2", content: PROMPT } });
  runs.setActiveBible("chaine-1", { id: "bible-1", content: BIBLE });
  const sent: Notification[] = [];
  const llm = makeLlm(script);
  const definition = createScoutDefinition(scout, () => NOW);
  const deps = { store: runs, llm, notifier: { async notify(notification: Notification) { sent.push(notification); } } };
  const request = { definition, input: INPUT, channelId: "chaine-1", videoId: null, jobKey: `scout:chaine-1:${WEEK}` };
  return { runs, scout, llm, sent, definition, deps, request };
}

describe("veilleur : définition", () => {
  it("reprend l'id, le slug et le nom du catalogue", () => {
    expect(registeredDefinition).toMatchObject({ id: 2, slug: "02-veilleur", name: "Veilleur", promptFile: "prompt.md" });
  });

  it("remplit toutes les variables du prompt et enregistre l'AgentRun", async () => {
    const { runs, llm, deps, request } = setup([VALID]);

    const result = await runAgent(request, deps);

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain("Tendance : objets vintage");
    expect(system).toContain("prioriser la cuisine");
    expect(system).toContain("- Pourquoi les crayons sont jaunes");
    expect(system).toContain("niche: objets du quotidien");
    expect(runs.runs[0]).toMatchObject({ status: "OK", promptVersionId: "pv-2", bibleVersionId: "bible-1", inputTokens: 1200, outputTokens: 3000, cost: 0.05 });
    expect(Object.keys(runs.runs[0]?.input ?? {}).sort()).toEqual(["APPRENTISSAGES", "BACKLOG_EXISTANT", "SIGNAUX"]);
  });

  it("enregistre une sortie normalisée et crée une vidéo par idée, avec une seule notification", async () => {
    const { runs, scout, deps, request } = setup([VALID]);

    await runAgent(request, deps);

    const output = runs.runs[0]?.output;
    expect(output).toMatchObject({ semaine: WEEK });
    const created = scout.videos.filter((video) => video.scoutJobId === "job-1");
    expect(created).toHaveLength(20);
    expect(created.every((video) => video.stage === "AWAITING_V1")).toBe(true);
    expect(scout.notifications).toBe(1);
    expect(created.find((video) => video.ideaId === "IDEE-005")?.procheDe).toBe("Pourquoi les crayons sont jaunes");
  });

  it("annonce l'absence de signaux et marque alors chaque idée comme hypothèse", async () => {
    const { runs, llm, deps, request } = setup([VALID], createFakeScoutStore());

    await runAgent(request, deps);

    expect(llm.requests[0]?.system).toContain(NO_SIGNALS);
    const parsed = request.definition.outputSchema.parse(runs.runs[0]?.output);
    expect(parsed.idees.every((idea) => idea.hypothese)).toBe(true);
  });

  it("relance après une sortie invalide puis passe en échec après 3 tentatives", async () => {
    const tooFew = JSON.stringify(makeOutput({ idees: makeOutput().idees.slice(0, 12) }));
    const { runs, scout, sent, llm, deps, request } = setup(["pas du JSON", tooFew, "{}"]);

    const result = await runAgent(request, deps);

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(runs.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "INVALID_JSON"]);
    expect(llm.requests[2]?.messages.at(-1)?.content).toContain("idees");
    expect(sent).toEqual([expect.objectContaining({ kind: "agent_failed", path: "/agents/02-veilleur" })]);
    expect(scout.videos.filter((video) => video.scoutJobId === "job-1")).toHaveLength(0);
  });

  it("renvoie au modèle la raison d'un contrôle refusé", async () => {
    const forbidden = makeOutput({ idees: makeOutput().idees.map((idea, index) => (index === 0 ? { ...idea, angle: "La politique des capsules" } : idea)) });
    const { runs, llm, deps, request } = setup([JSON.stringify(forbidden), VALID]);

    const result = await runAgent(request, deps);

    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(runs.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(llm.requests[1]?.messages.at(-1)?.content).toContain("Sujets interdits");
  });

  it("refuse normalize sans buildVariables : le contexte de la veille manque", () => {
    const { definition } = setup([]);
    const ctx = { channelId: "chaine-1", videoId: null, bible: BIBLE, bibleVersionId: "bible-1" };
    expect(() => definition.normalize?.(makeOutput(), INPUT, ctx)).toThrow(/Contexte de veille absent/);
  });
});

describe("veilleur : onSuccess idempotent", () => {
  it("ne recrée aucune vidéo quand il est rejoué avec la même sortie", async () => {
    const { scout, definition } = setup([]);
    const output = makeOutput({ semaine: WEEK });
    const ctx = { channelId: "chaine-1", videoId: null, bible: BIBLE, bibleVersionId: "bible-1" };

    await definition.onSuccess(output, INPUT, ctx);
    await definition.onSuccess(output, INPUT, ctx);

    expect(scout.videos.filter((video) => video.scoutJobId === "job-1")).toHaveLength(20);
    expect(scout.notifications).toBe(1);
  });

  it("termine après un crash, sans doublon ni nouvel appel au modèle", async () => {
    const scout = createFakeScoutStore({ signals: "signal" });
    scout.crashAfterCreates = 5;
    const { llm, deps, request } = setup([VALID], scout);

    await expect(runAgent(request, deps)).rejects.toThrow("crash simulé");
    expect(scout.videos.filter((video) => video.scoutJobId === "job-1")).toHaveLength(5);

    const resumed = await runAgent(request, deps);

    expect(resumed).toMatchObject({ status: "ok", reused: true });
    expect(llm.requests).toHaveLength(1);
    const created = scout.videos.filter((video) => video.scoutJobId === "job-1");
    expect(created).toHaveLength(20);
    expect(new Set(created.map((video) => video.ideaId)).size).toBe(20);
    expect(created.every((video) => video.stage === "AWAITING_V1")).toBe(true);
  });

  it("prévient l'humain quand la reprise ne fait que débloquer des vidéos restées en IDEA", async () => {
    const scout = createFakeScoutStore();
    scout.crashAfterCreates = 20;
    const { definition } = setup([], scout);
    const ctx = { channelId: "chaine-1", videoId: null, bible: BIBLE, bibleVersionId: "bible-1" };

    await expect(definition.onSuccess(makeOutput(), INPUT, ctx)).rejects.toThrow("crash simulé");
    expect(scout.notifications).toBe(0);
    await definition.onSuccess(makeOutput(), INPUT, ctx);

    expect(scout.videos.every((video) => video.stage === "AWAITING_V1")).toBe(true);
    expect(scout.notifications).toBe(1);
  });
});
