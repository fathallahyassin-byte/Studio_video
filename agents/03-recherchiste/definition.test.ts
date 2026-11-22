import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { Stage } from "@/lib/generated/prisma/client";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createResearchDefinition, definition, recordDossier } from "./definition";
import { makeDossier, makeFact } from "./fixtures";
import type { ResearchPorts } from "./ports";
import { NO_RELIABLE_FACT_REASON, NO_SOURCES_TEXT } from "./rules";
import type { Output } from "./schema";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const VIDEO_ID = "video-1";
const IDEA = { id: "I-07", angle: "Le trombone n'a pas été inventé par qui on croit", revelation: "brevet de 1899" };

/** Vidéo en mémoire : les transitions changent l'étape comme le ferait lib/pipeline. */
function makePorts(options: { stage?: Stage; idea?: unknown; exists?: boolean } = {}) {
  const video = { stage: options.stage ?? "RESEARCH", idea: options.idea === undefined ? IDEA : options.idea };
  const calls = { saved: [] as Output[], completed: 0, blocked: [] as string[] };
  const ports: ResearchPorts = {
    async loadVideo() {
      return options.exists === false ? null : { ...video };
    },
    async loadHumanSources() {
      return [];
    },
    async saveDossier(_videoId, dossier) {
      calls.saved.push(dossier);
    },
    async completeResearch() {
      if (video.stage !== "RESEARCH") throw new Error("transition impossible");
      calls.completed += 1;
      video.stage = "SCRIPT";
    },
    async block(_videoId, reason) {
      if (video.stage !== "RESEARCH") throw new Error("transition impossible");
      calls.blocked.push(reason);
      video.stage = "NEEDS_FIX";
    },
  };
  return { ports, video, calls };
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
      return { text, inputTokens: 1200, outputTokens: 800, cost: 0.03 };
    },
  };
}

function setup(answers: string[], portOptions: Parameters<typeof makePorts>[0] = {}) {
  const fake = makePorts(portOptions);
  const researchDefinition = createResearchDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 3, slug: "03-recherchiste", name: "Recherchiste & fact-checker", model: "modele-test", active: true, promptVersion: { id: "pv-3", content: PROMPT } });
  store.setActiveBible("chaine-1", { id: "bible-1", content: "niche: objets du quotidien" });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: "chaine-1", videoId: VIDEO_ID, note: "angle historique", payload: null };
  const run = () =>
    runAgent({ definition: researchDefinition, input, channelId: "chaine-1", videoId: VIDEO_ID, jobKey: "transition-1:agent-3" }, { store, llm, notifier });
  return { ...fake, researchDefinition, store, llm, sent, input, run };
}

const json = (dossier: unknown) => JSON.stringify(dossier);

describe("définition exportée", () => {
  it("reprend l'identité du catalogue et le schéma de l'agent", () => {
    expect(definition).toMatchObject({ id: 3, slug: "03-recherchiste", name: "Recherchiste & fact-checker", promptFile: "prompt.md" });
  });
});

describe("recherchiste avec runAgent (faux LLM)", () => {
  it("sortie valide : remplit toutes les variables, enregistre l'AgentRun et le dossier, puis passe au script", async () => {
    const ctx = setup([json(makeDossier())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('"id": "I-07"');
    expect(system).toContain("Note de l'humain, à prendre en compte : angle historique");
    expect(system).toContain(NO_SOURCES_TEXT);
    expect(system).toContain("niche: objets du quotidien");

    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 3,
      promptVersionId: "pv-3",
      bibleVersionId: "bible-1",
      inputTokens: 1200,
      outputTokens: 800,
      cost: 0.03,
      input: { IDEE: expect.stringContaining("I-07"), SOURCES: NO_SOURCES_TEXT },
    });
    expect(ctx.calls.saved).toHaveLength(1);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.calls.blocked).toEqual([]);
  });

  it("enregistre le dossier normalisé : une URL « source à trouver » devient « faible »", async () => {
    const dossier = makeDossier();
    const tricked = { ...dossier, faits: dossier.faits.map((fact) => (fact.id === "F5" ? { ...fact, confiance: "eleve" as const } : fact)) };
    const ctx = setup([json(tricked)]);
    await ctx.run();
    expect(ctx.calls.saved[0]?.faits.find((fact) => fact.id === "F5")?.confiance).toBe("faible");
  });

  it("sortie invalide trois fois : 3 AgentRun, vidéo en NEEDS_FIX, aucun dossier ni scénariste", async () => {
    const ctx = setup(["pas du JSON", json({ ...makeDossier(), verdict: "peut-etre" }), json(makeDossier({ verdict: "angle_a_changer" }))]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("angle_de_remplacement");
    expect(ctx.store.needsFix.get(VIDEO_ID)).toContain("Recherchiste");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(ctx.calls.saved).toEqual([]);
    expect(ctx.calls.completed).toBe(0);
  });

  it("relance avec le message d'erreur d'un contrôle, puis accepte la correction", async () => {
    const ctx = setup([json(makeDossier({ idee_id: "autre" })), json(makeDossier())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("I-07");
  });

  it("aucun fait « eleve » ou « moyen » : la vidéo est bloquée, le scénariste n'est pas lancé", async () => {
    const weak = makeDossier({
      faits: ["F1", "F2", "F3", "F4", "F5"].map((id) => makeFact({ id, url: "" })),
    });
    const ctx = setup([json(weak)]);
    await ctx.run();
    expect(ctx.calls.completed).toBe(0);
    expect(ctx.calls.blocked).toEqual([NO_RELIABLE_FACT_REASON]);
    expect(ctx.video.stage).toBe("NEEDS_FIX");
  });

  it("angle à changer : la vidéo est bloquée avec l'angle de remplacement", async () => {
    const ctx = setup([json(makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: "Raconter le vrai brevet de 1899" }))]);
    await ctx.run();
    expect(ctx.calls.completed).toBe(0);
    expect(ctx.calls.blocked).toEqual([expect.stringContaining("Raconter le vrai brevet de 1899")]);
    expect(ctx.calls.saved).toHaveLength(1);
  });
});

describe("buildVariables", () => {
  it("refuse une tâche sans vidéo, une vidéo introuvable ou une vidéo sans idée, sans appeler le modèle", async () => {
    const noVideo = setup([]);
    const input = { ...noVideo.input, videoId: null };
    await expect(noVideo.researchDefinition.buildVariables(input, { channelId: "chaine-1", videoId: null, bible: null, bibleVersionId: null })).rejects.toThrow(AgentPreconditionError);

    const missing = setup([json(makeDossier())], { exists: false });
    await expect(missing.run()).rejects.toThrow(AgentPreconditionError);
    expect(missing.llm.requests).toEqual([]);

    const noIdea = setup([json(makeDossier())], { idea: null });
    await expect(noIdea.run()).rejects.toThrow(AgentPreconditionError);
    expect(noIdea.llm.requests).toEqual([]);
  });
});

describe("onSuccess idempotent", () => {
  it("rejoué après la transition, il ne refait rien", async () => {
    const ctx = setup([]);
    const ctxArg = { channelId: "chaine-1", videoId: VIDEO_ID, bible: null, bibleVersionId: null };
    await ctx.researchDefinition.onSuccess(makeDossier(), ctx.input, ctxArg);
    await ctx.researchDefinition.onSuccess(makeDossier(), ctx.input, ctxArg);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.calls.saved).toHaveLength(1);
  });

  it.each<Stage>(["SCRIPT", "NEEDS_FIX", "REJECTED", "AWAITING_V2"])("vidéo déjà en %s : ni enregistrement, ni transition, ni erreur", async (stage) => {
    const { ports, calls } = makePorts({ stage });
    await expect(recordDossier(ports, VIDEO_ID, makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: "x" }))).resolves.toBeUndefined();
    await expect(recordDossier(ports, VIDEO_ID, makeDossier())).resolves.toBeUndefined();
    expect(calls).toEqual({ saved: [], completed: 0, blocked: [] });
  });

  it("vidéo supprimée : ne lève pas d'erreur", async () => {
    const { ports, calls } = makePorts({ exists: false });
    await expect(recordDossier(ports, VIDEO_ID, makeDossier())).resolves.toBeUndefined();
    expect(calls.saved).toEqual([]);
  });

  it("reprise après un crash entre l'enregistrement et la transition : la transition est faite une fois", async () => {
    const fake = makePorts();
    const crashing: ResearchPorts = {
      ...fake.ports,
      async completeResearch() {
        throw new Error("crash du worker");
      },
    };
    await expect(recordDossier(crashing, VIDEO_ID, makeDossier())).rejects.toThrow("crash du worker");
    expect(fake.video.stage).toBe("RESEARCH");

    await recordDossier(fake.ports, VIDEO_ID, makeDossier());
    await recordDossier(fake.ports, VIDEO_ID, makeDossier());
    expect(fake.calls.completed).toBe(1);
    expect(fake.video.stage).toBe("SCRIPT");
  });

  it("transition refusée parce que l'humain a déplacé la vidéo entre-temps : pas d'erreur", async () => {
    const fake = makePorts();
    const racing: ResearchPorts = {
      ...fake.ports,
      async completeResearch() {
        fake.video.stage = "REJECTED";
        throw new Error("La vidéo a changé d'étape entre-temps : recharge la page.");
      },
    };
    await expect(recordDossier(racing, VIDEO_ID, makeDossier())).resolves.toBeUndefined();
  });

  it("transition en échec alors que la vidéo est toujours en recherche : l'erreur remonte (la file réessaiera)", async () => {
    const fake = makePorts();
    const failing: ResearchPorts = {
      ...fake.ports,
      async block() {
        throw new Error("base indisponible");
      },
    };
    await expect(recordDossier(failing, VIDEO_ID, makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: "x" }))).rejects.toThrow("base indisponible");
  });
});
