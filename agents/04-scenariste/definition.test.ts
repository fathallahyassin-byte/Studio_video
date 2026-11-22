import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentContext, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { Stage } from "@/lib/generated/prisma/client";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createScriptDefinition, definition, recordScript } from "./definition";
import { IDEA, makeDossier, makeScript, TEST_BIBLE, withBeat } from "./fixtures";
import type { ScriptPorts, ScriptVideo } from "./ports";
import type { Output } from "./schema";
import { CORRECTION_HEADING, NO_LEARNINGS, NO_PUBLISHED_SCRIPTS } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const VIDEO_ID = "video-1";
const CHANNEL_ID = "chaine-1";

type PortOptions = { stage?: Stage; exists?: boolean; video?: Partial<ScriptVideo>; report?: unknown; published?: unknown[] };

/** Vidéo en mémoire : la transition change l'étape comme le ferait lib/pipeline. */
function makePorts(options: PortOptions = {}) {
  const video: ScriptVideo = { stage: options.stage ?? "SCRIPT", idea: IDEA, dossier: makeDossier(), script: null, ...options.video };
  const calls = { saved: [] as Output[], completed: 0, publishedLimit: 0 };
  const ports: ScriptPorts = {
    async loadVideo() {
      return options.exists === false ? null : { ...video };
    },
    async loadLatestReport() {
      return options.report ?? null;
    },
    async loadPublishedScripts(_channelId, limit) {
      calls.publishedLimit = limit;
      return options.published ?? [];
    },
    async saveScript(_videoId, script) {
      calls.saved.push(script);
      video.script = script;
    },
    async completeScript() {
      if (video.stage !== "SCRIPT") throw new Error("transition impossible");
      calls.completed += 1;
      video.stage = "AWAITING_V2";
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
      return { text, inputTokens: 3000, outputTokens: 1500, cost: 0.05 };
    },
  };
}

function setup(answers: string[], options: PortOptions & { note?: string | null; bible?: string | null } = {}) {
  const fake = makePorts(options);
  const scriptDefinition = createScriptDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 4, slug: "04-scenariste", name: "Scénariste", model: "modele-test", active: true, promptVersion: { id: "pv-4", content: PROMPT } });
  const bible = options.bible === undefined ? TEST_BIBLE : options.bible;
  if (bible !== null) store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: bible });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: VIDEO_ID, note: options.note ?? null, payload: null };
  const run = () => runAgent({ definition: scriptDefinition, input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "transition-1:agent-4" }, { store, llm, notifier });
  return { ...fake, scriptDefinition, store, llm, sent, input, run };
}

const json = (value: unknown) => JSON.stringify(value);
const ctxOf = (bible: string | null): AgentContext => ({ channelId: CHANNEL_ID, videoId: VIDEO_ID, bible, bibleVersionId: bible === null ? null : "bible-1" });

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 4, slug: "04-scenariste", promptFile: "prompt.md" });
  });
});

describe("scénariste avec runAgent (faux LLM)", () => {
  it("sortie valide : toutes les variables remplies, AgentRun complet, script enregistré, vidéo en attente de V2", async () => {
    const ctx = setup([json(makeScript())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('"id": "I-07"');
    expect(system).toContain('"F1"');
    expect(system).toContain(NO_LEARNINGS);
    expect(system).toContain(NO_PUBLISHED_SCRIPTS);
    expect(system).toContain("Durée cible : 25 secondes");
    expect(system).toContain('niche: "objets du quotidien"');
    expect(ctx.calls.publishedLimit).toBe(5);

    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 4,
      promptVersionId: "pv-4",
      bibleVersionId: "bible-1",
      inputTokens: 3000,
      outputTokens: 1500,
      cost: 0.05,
      input: { IDEE: expect.stringContaining("I-07"), DOSSIER: expect.stringContaining("F2"), DUREE_S: "25" },
    });
    expect(ctx.calls.saved).toHaveLength(1);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.video.stage).toBe("AWAITING_V2");
  });

  it("enregistre les compteurs recalculés en code, pas ceux du modèle", async () => {
    const ctx = setup([json(makeScript({ nb_mots: 300, duree_estimee_s: 99 }))]);
    await ctx.run();
    expect(ctx.calls.saved[0]).toMatchObject({ nb_mots: 50, duree_estimee_s: 25 });
    expect(ctx.store.runs[0]?.output).toMatchObject({ nb_mots: 50, duree_estimee_s: 25 });
  });

  it("sortie invalide trois fois : 3 AgentRun, vidéo en NEEDS_FIX, aucun script enregistré", async () => {
    const ctx = setup(["pas du JSON", json({ ...makeScript(), accroches: [] }), json(withBeat(3, { faits: ["F3"] }))]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("F3 (beat 3)");
    expect(ctx.store.needsFix.get(VIDEO_ID)).toContain("Scénariste");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(ctx.calls.saved).toEqual([]);
    expect(ctx.calls.completed).toBe(0);
  });

  it("fait inconnu : refusé en code, renvoyé au modèle (une tentative), puis correction acceptée", async () => {
    const ctx = setup([json(withBeat(3, { faits: ["F12"] })), json(makeScript())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("F12 (beat 3)");
  });

  it("nombre de mots hors tolérance : refusé en code avec le compte recalculé", async () => {
    const long = withBeat(2, { voix: "Tu en utilises des dizaines sans jamais vraiment y penser. Chaque jour, au bureau, partout." });
    const ctx = setup([json(long), json(makeScript())]);
    await ctx.run();
    expect(ctx.store.runs[0]?.error).toContain("55 mots");
    expect(ctx.calls.completed).toBe(1);
  });

  it("beats incohérents : refusés en code", async () => {
    const ctx = setup([json(withBeat(4, { debut_s: 13 })), json(makeScript())]);
    await ctx.run();
    expect(ctx.store.runs[0]).toMatchObject({ status: "CONTROL_FAILED", error: expect.stringContaining("chevauche") });
  });
});

describe("buildVariables", () => {
  it("note de correction V2 : ajoutée à {{IDEE}} avec le script précédent", async () => {
    const ctx = setup([json(makeScript())], { note: "Chute trop faible.", video: { script: makeScript({ titre_interne: "Version 1" }) } });
    await ctx.run();
    const idee = ctx.store.runs[0]?.input.IDEE ?? "";
    expect(idee).toContain(`${CORRECTION_HEADING} :\nChute trop faible.`);
    expect(idee).toContain("Version 1");
  });

  it("apprentissages et derniers scripts publiés", async () => {
    const report = { enseignements: [{ observation: "Les boucles marchent", nb_videos: 3, confiance: "forte", decision: "garder la boucle" }] };
    const ctx = setup([json(makeScript())], { report, published: [makeScript({ titre_interne: "Le crayon jaune" })] });
    await ctx.run();
    expect(ctx.store.runs[0]?.input).toMatchObject({
      APPRENTISSAGES: expect.stringContaining("Les boucles marchent"),
      DERNIERS_SCRIPTS: expect.stringContaining("Le crayon jaune"),
    });
  });

  it.each([
    ["sans dossier", { video: { dossier: null } }, /pas de dossier factuel/],
    ["dossier illisible", { video: { dossier: { faits: [] } } }, /illisible/],
    ["vidéo sans idée", { video: { idea: null } }, /pas d'idée/],
    ["vidéo introuvable", { exists: false }, /introuvable/],
    ["sans bible", { bible: null }, /Aucune bible/],
  ] as const)("%s : précondition, aucun appel au modèle", async (_label, options, message) => {
    const ctx = setup([json(makeScript())], options);
    await expect(ctx.run()).rejects.toThrow(AgentPreconditionError);
    await expect(ctx.run()).rejects.toThrow(message);
    expect(ctx.llm.requests).toEqual([]);
    expect(ctx.store.runs).toEqual([]);
  });

  it("refuse une tâche sans vidéo", async () => {
    const ctx = setup([]);
    await expect(ctx.scriptDefinition.buildVariables({ ...ctx.input, videoId: null }, ctxOf(TEST_BIBLE))).rejects.toThrow(AgentPreconditionError);
  });

  it("normalize et controls lisent la cible dans la bible de l'appel, sans dépendre de buildVariables", async () => {
    const ctx = setup([]);
    const slowerBible = TEST_BIBLE.replace("debit_voix_mots_par_s: 2", "debit_voix_mots_par_s: 2.5");
    const normalized = await ctx.scriptDefinition.normalize?.(makeScript(), ctx.input, ctxOf(slowerBible));
    expect(normalized).toMatchObject({ nb_mots: 50, duree_estimee_s: 20, verifications: { duree_ok: false } });
    const results = await ctx.scriptDefinition.controls?.(makeScript(), ctx.input, ctxOf(slowerBible));
    expect(results).toContainEqual({ ok: false, reason: expect.stringContaining("2.5 mots/s") });
  });
});

describe("onSuccess idempotent", () => {
  it("rejoué après la transition, il ne refait rien", async () => {
    const ctx = setup([]);
    await ctx.scriptDefinition.onSuccess(makeScript(), ctx.input, ctxOf(TEST_BIBLE));
    await ctx.scriptDefinition.onSuccess(makeScript(), ctx.input, ctxOf(TEST_BIBLE));
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.calls.saved).toHaveLength(1);
  });

  it.each<Stage>(["AWAITING_V2", "NEEDS_FIX", "REJECTED", "VISUALS_AND_AUDIO"])("vidéo déjà en %s : ni enregistrement, ni transition, ni erreur", async (stage) => {
    const { ports, calls } = makePorts({ stage });
    await expect(recordScript(ports, VIDEO_ID, makeScript())).resolves.toBeUndefined();
    expect(calls).toMatchObject({ saved: [], completed: 0 });
  });

  it("vidéo supprimée : ne lève pas d'erreur", async () => {
    const { ports, calls } = makePorts({ exists: false });
    await expect(recordScript(ports, VIDEO_ID, makeScript())).resolves.toBeUndefined();
    expect(calls.saved).toEqual([]);
  });

  it("reprise après un crash entre l'enregistrement et la transition : la transition est faite une fois", async () => {
    const fake = makePorts();
    const crashing: ScriptPorts = {
      ...fake.ports,
      async completeScript() {
        throw new Error("crash du worker");
      },
    };
    await expect(recordScript(crashing, VIDEO_ID, makeScript())).rejects.toThrow("crash du worker");
    expect(fake.video.stage).toBe("SCRIPT");

    await recordScript(fake.ports, VIDEO_ID, makeScript());
    await recordScript(fake.ports, VIDEO_ID, makeScript());
    expect(fake.calls.completed).toBe(1);
    expect(fake.video.stage).toBe("AWAITING_V2");
  });

  it("transition refusée parce que l'humain a déplacé la vidéo entre-temps : pas d'erreur", async () => {
    const fake = makePorts();
    const racing: ScriptPorts = {
      ...fake.ports,
      async completeScript() {
        fake.video.stage = "REJECTED";
        throw new Error("La vidéo a changé d'étape entre-temps : recharge la page.");
      },
    };
    await expect(recordScript(racing, VIDEO_ID, makeScript())).resolves.toBeUndefined();
  });

  it("runAgent rejoue onSuccess après un crash sans rappeler le modèle", async () => {
    const ctx = setup([json(makeScript())]);
    const original = ctx.ports.completeScript;
    ctx.ports.completeScript = async () => {
      throw new Error("crash du worker");
    };
    await expect(ctx.run()).rejects.toThrow("crash du worker");
    ctx.ports.completeScript = original;
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", reused: true });
    expect(ctx.llm.requests).toHaveLength(1);
    expect(ctx.calls.completed).toBe(1);
  });
});
