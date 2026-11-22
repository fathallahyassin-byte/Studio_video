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
import { createStoryboardDefinition, definition, recordStoryboard } from "./definition";
import { makePorts, makeStoryboard, TEST_BIBLE, withPlan, type PortOptions } from "./fixtures";
import type { StoryboardPorts } from "./ports";
import { CORRECTION_HEADING, NO_GENERATOR } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const VIDEO_ID = "video-1";
const CHANNEL_ID = "chaine-1";

function makeLlm(answers: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "faux",
    requests,
    async complete(request) {
      requests.push(request);
      const text = answers.shift();
      if (text === undefined) throw new Error("plus de réponse prévue");
      return { text, inputTokens: 4000, outputTokens: 2500, cost: 0.07 };
    },
  };
}

function setup(answers: string[], options: PortOptions & { note?: string | null } = {}) {
  const fake = makePorts(options);
  const storyboardDefinition = createStoryboardDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 5, slug: "05-directeur-artistique", name: "Directeur artistique", model: "modele-test", active: true, promptVersion: { id: "pv-5", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: TEST_BIBLE });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: VIDEO_ID, note: options.note ?? null, payload: null };
  const run = () => runAgent({ definition: storyboardDefinition, input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "transition-1:agent-5" }, { store, llm, notifier });
  return { ...fake, storyboardDefinition, store, llm, sent, input, run };
}

const json = (value: unknown) => JSON.stringify(value);
const ctx: AgentContext = { channelId: CHANNEL_ID, videoId: VIDEO_ID, bible: TEST_BIBLE, bibleVersionId: "bible-1" };

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 5, slug: "05-directeur-artistique", promptFile: "prompt.md" });
  });
});

describe("directeur artistique avec runAgent (faux LLM, faux générateurs)", () => {
  it("sortie valide : variables remplies, AgentRun complet, médias générés, storyboard enregistré, passage au montage", async () => {
    const ctx = setup([json(makeStoryboard())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('"idee_id": "I-07"');
    expect(system).toContain("Modèle vidéo IA : faux-video");
    expect(system).toContain("Modèle image IA : faux-image");
    expect(system).toContain("Budget vidéo IA par vidéo : 12 secondes");
    expect(system).toContain('style_visuel_en: "flat pastel illustration, soft light"');

    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 5,
      promptVersionId: "pv-5",
      bibleVersionId: "bible-1",
      inputTokens: 4000,
      outputTokens: 2500,
      cost: 0.07,
      input: { SCRIPT: expect.stringContaining("I-07"), BUDGET_SECONDES_VIDEO_IA: "12" },
    });
    expect(ctx.image.requests).toHaveLength(3);
    expect(ctx.videoGen.requests.map((request) => request.durationS)).toEqual([3, 3]);
    expect(ctx.media.records.map((record) => record.planId)).toEqual(["P01", "P02", "P05", "P06", "P08"]);
    expect(ctx.calls.saved).toHaveLength(1);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.video.stage).toBe("EDIT");
  });

  it("enregistre secondes_video_ia recalculé en code, pas la valeur du modèle", async () => {
    const ctx = setup([json(makeStoryboard({ secondes_video_ia: 0.5 }))]);
    await ctx.run();
    expect(ctx.calls.saved[0]?.secondes_video_ia).toBe(6);
    expect(ctx.store.runs[0]?.output).toMatchObject({ secondes_video_ia: 6 });
  });

  it("sortie invalide trois fois : 3 AgentRun, NEEDS_FIX, alerte, aucune génération ni enregistrement", async () => {
    const ctx = setup(["pas du JSON", json({ ...makeStoryboard(), plans: [] }), json(withPlan("P03", { debut_s: 6 }))]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("Trou de 0.5 s");
    expect(ctx.store.needsFix.get(VIDEO_ID)).toContain("Directeur artistique");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(ctx.media.records).toEqual([]);
    expect(ctx.calls.saved).toEqual([]);
  });

  it("dépassement du budget de vidéo IA : refusé, renvoyé au modèle avec le total, puis correction acceptée", async () => {
    const over = withPlan("P05", { type: "video_ia" }, withPlan("P06", { type: "video_ia" }));
    const ctx = setup([json(over), json(makeStoryboard())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("13.5 s pour un budget de 12 s");
  });

  it("dépassement du budget trois fois : NEEDS_FIX et alerte, sans aucune génération", async () => {
    const over = json(withPlan("P05", { type: "video_ia" }, withPlan("P06", { type: "video_ia" })));
    const ctx = setup([over, over, over]);
    expect(await ctx.run()).toMatchObject({ status: "needs_fix" });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.image.requests).toEqual([]);
    expect(ctx.videoGen.requests).toEqual([]);
  });

  it("aucun générateur branché : le modèle en est prévenu et les types générés sont refusés", async () => {
    const textOnly = makeStoryboard({
      plans: makeStoryboard().plans.map((plan) =>
        plan.type === "image_ia_animee" || plan.type === "video_ia" ? { ...plan, type: "stock", prompt_en: null, negative_prompt_en: null, mots_cles_stock: ["desk"], label_ia_requis: false } : plan,
      ),
    });
    const ctx = setup([json(makeStoryboard()), json(textOnly)], { tools: "none" });
    const result = await ctx.run();
    expect(ctx.llm.requests[0]?.system).toContain(NO_GENERATOR);
    expect(ctx.store.runs[0]?.error).toContain("aucun modèle vidéo IA");
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.video.stage).toBe("EDIT");
  });
});

describe("buildVariables", () => {
  it("note de l'humain : ajoutée à {{SCRIPT}} avec le storyboard précédent", async () => {
    const ctx = setup([json(makeStoryboard())], { note: "Plans trop sombres.", video: { previousStoryboard: makeStoryboard({ couverture: { plan: "P01", texte: "Version 1" } }) } });
    await ctx.run();
    const script = ctx.store.runs[0]?.input.SCRIPT ?? "";
    expect(script).toContain(`${CORRECTION_HEADING} :\nPlans trop sombres.`);
    expect(script).toContain("Version 1");
  });

  it.each([
    ["sans script", { video: { script: null } }, /pas de script/],
    ["script illisible", { video: { script: { beats: [] } } }, /illisible/],
    ["vidéo introuvable", { exists: false }, /introuvable/],
    ["budget de vidéo IA absent", { budgets: { videoAiSeconds: "" } }, /BUDGET_SECONDES_VIDEO_IA/],
    ["budget de vidéo IA invalide", { budgets: { videoAiSeconds: "douze" } }, /BUDGET_SECONDES_VIDEO_IA/],
  ] as const)("%s : précondition, aucun appel au modèle", async (_label, options, message) => {
    const ctx = setup([json(makeStoryboard())], options);
    await expect(ctx.run()).rejects.toThrow(AgentPreconditionError);
    await expect(ctx.run()).rejects.toThrow(message);
    expect(ctx.llm.requests).toEqual([]);
    expect(ctx.store.runs).toEqual([]);
  });

  it("refuse une tâche sans vidéo", async () => {
    const ctx = setup([]);
    await expect(ctx.storyboardDefinition.buildVariables({ ...ctx.input, videoId: null }, { ...ctx.input, bible: TEST_BIBLE, bibleVersionId: "bible-1", videoId: null })).rejects.toThrow(AgentPreconditionError);
  });
});

describe("onSuccess idempotent", () => {
  it("rejoué après la transition, il ne refait rien", async () => {
    const ctx = setup([]);
    await ctx.storyboardDefinition.onSuccess(makeStoryboard(), ctx.input, { ...ctx.input, bible: TEST_BIBLE, bibleVersionId: "bible-1" });
    await ctx.storyboardDefinition.onSuccess(makeStoryboard(), ctx.input, { ...ctx.input, bible: TEST_BIBLE, bibleVersionId: "bible-1" });
    expect(ctx.media.records).toHaveLength(5);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.calls.saved).toHaveLength(1);
  });

  it.each<Stage>(["EDIT", "NEEDS_FIX", "REJECTED", "AWAITING_V2"])("vidéo déjà en %s : ni génération, ni enregistrement, ni erreur", async (stage) => {
    const fake = makePorts({ stage });
    await expect(recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard())).resolves.toBeUndefined();
    expect(fake.media.records).toEqual([]);
    expect(fake.calls).toMatchObject({ saved: [], completed: 0, blocked: [] });
  });

  it("vidéo supprimée : ne lève pas d'erreur", async () => {
    const fake = makePorts({ exists: false });
    await expect(recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard())).resolves.toBeUndefined();
  });

  it("crash pendant la génération : la reprise ne relance que les plans manquants", async () => {
    const fake = makePorts();
    const original = fake.videoGen.generate;
    let calls = 0;
    fake.videoGen.generate = async (request) => {
      calls += 1;
      if (calls === 2) throw new Error("panne du générateur");
      return original(request);
    };
    await expect(recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard())).rejects.toThrow("panne du générateur");
    expect(fake.media.records.map((record) => record.planId)).toEqual(["P01", "P02", "P05", "P06"]);
    expect(fake.calls.saved).toEqual([]);
    expect(fake.video.stage).toBe("VISUALS_AND_AUDIO");

    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.media.records.map((record) => record.planId)).toEqual(["P01", "P02", "P05", "P06", "P08"]);
    expect(fake.image.requests).toHaveLength(3);
    expect(fake.calls.completed).toBe(1);
  });

  it("crash entre l'enregistrement et la transition : la reprise ne régénère rien et passe une fois", async () => {
    const fake = makePorts();
    const crashing: StoryboardPorts = { ...fake.ports, completeMedia: async () => Promise.reject(new Error("crash du worker")) };
    await expect(recordStoryboard(crashing, VIDEO_ID, makeStoryboard())).rejects.toThrow("crash du worker");
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.media.records).toHaveLength(5);
    expect(fake.calls.completed).toBe(1);
  });

  it("transition refusée parce que l'agent 6 ou l'humain a déplacé la vidéo entre-temps : pas d'erreur", async () => {
    const fake = makePorts();
    const racing: StoryboardPorts = {
      ...fake.ports,
      async completeMedia() {
        fake.video.stage = "EDIT";
        throw new Error("La vidéo a changé d'étape entre-temps : recharge la page.");
      },
    };
    await expect(recordStoryboard(racing, VIDEO_ID, makeStoryboard())).resolves.toBeUndefined();
  });

  it("vidéo abandonnée pendant la génération : on s'arrête avant le plan suivant", async () => {
    const fake = makePorts();
    const original = fake.image.generate;
    fake.image.generate = async (request) => {
      fake.video.stage = "REJECTED";
      return original(request);
    };
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.media.records.map((record) => record.planId)).toEqual(["P01", "P02"]);
    expect(fake.calls).toMatchObject({ saved: [], completed: 0, blocked: [] });
  });

  it("runAgent rejoue onSuccess après un crash sans rappeler le modèle ni régénérer", async () => {
    const ctx = setup([json(makeStoryboard())]);
    const original = ctx.ports.completeMedia;
    ctx.ports.completeMedia = async () => Promise.reject(new Error("crash du worker"));
    await expect(ctx.run()).rejects.toThrow("crash du worker");
    ctx.ports.completeMedia = original;
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", reused: true });
    expect(ctx.llm.requests).toHaveLength(1);
    expect(ctx.media.records).toHaveLength(5);
    expect(ctx.video.stage).toBe("EDIT");
  });
});

describe("budgets avant génération (onSuccess)", () => {
  it("coût estimé au-delà du budget de la vidéo : blocage et alerte, rien n'est généré", async () => {
    const fake = makePorts({ budgets: { perVideo: "0.5" }, video: { totalCost: 0.2 } });
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.media.records).toEqual([]);
    expect(fake.calls.blocked).toEqual([expect.stringContaining("génération estimée à 0,72 €, il reste 0,30 €")]);
    expect(fake.video.stage).toBe("NEEDS_FIX");
    expect(fake.calls.saved).toHaveLength(1);
    expect(fake.calls.completed).toBe(0);
  });

  it("BUDGET_PAR_VIDEO absent : génération payante refusée, vidéo bloquée", async () => {
    const fake = makePorts({ budgets: { perVideo: undefined } });
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.calls.blocked).toEqual([expect.stringContaining("BUDGET_PAR_VIDEO")]);
    expect(fake.media.records).toEqual([]);
  });

  it("secondes de vidéo IA au-delà du budget (sortie rejouée après une baisse du budget) : blocage sans génération", async () => {
    const fake = makePorts({ budgets: { videoAiSeconds: "4" } });
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.calls.blocked).toEqual([expect.stringContaining("6 s de vidéo IA pour un budget de 4 s")]);
    expect(fake.media.records).toEqual([]);
  });

  it("générateur retiré entre la sortie et la génération : blocage avec les plans concernés", async () => {
    const fake = makePorts({ tools: "none" });
    await recordStoryboard(fake.ports, VIDEO_ID, makeStoryboard());
    expect(fake.calls.blocked).toEqual([expect.stringContaining("P01, P02, P05, P06, P08")]);
  });

  it("storyboard sans plan généré : aucun budget requis, passage direct au montage", async () => {
    const fake = makePorts({ budgets: { perVideo: undefined }, tools: "none" });
    const storyboard = makeStoryboard({ plans: makeStoryboard().plans.map((plan) => ({ ...plan, type: "texte_anime" as const })) });
    await recordStoryboard(fake.ports, VIDEO_ID, storyboard);
    expect(fake.calls.completed).toBe(1);
  });
});

describe("normalize et controls", () => {
  it("relisent le script en base et la bible de l'appel, sans dépendre de buildVariables", async () => {
    const fake = setup([]);
    const normalized = await fake.storyboardDefinition.normalize?.(makeStoryboard({ secondes_video_ia: 1 }), fake.input, ctx);
    expect(normalized?.secondes_video_ia).toBe(6);
    const noStyle = await fake.storyboardDefinition.controls?.(withPlan("P02", { prompt_en: "x, vertical 9:16 composition" }), fake.input, { ...ctx, bible: null });
    expect(noStyle?.every((result) => result.ok)).toBe(true);
  });
});
