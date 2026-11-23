import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createEditorDefinition, definition, recordTimeline, usesOutdatedSound } from "./definition";
import { makeAssets, makeAudioJson, makeAudioPlan, makeContext, makePorts, makeTimeline, TEST_BIBLE, VOICE_URL, withClips, type PortOptions } from "./fixtures";
import { MAX_TAIL_S, normalizeTimeline } from "./rules";
import { NO_TIMINGS, NO_VOICE } from "./sources";
import { CORRECTION_HEADING } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const VIDEO_ID = "video-1";
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
      return { text, inputTokens: 5000, outputTokens: 1800, cost: 0.06 };
    },
  };
}

function setup(answers: string[], options: PortOptions & { note?: string | null } = {}) {
  const fake = makePorts(options);
  const editorDefinition = createEditorDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 7, slug: "07-monteur", name: "Monteur", model: "modele-test", active: true, promptVersion: { id: "pv-7", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: TEST_BIBLE });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: VIDEO_ID, note: options.note ?? null, payload: null };
  const run = () => runAgent({ definition: editorDefinition, input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "transition-1:agent-7" }, { store, llm, notifier });
  return { ...fake, editorDefinition, store, llm, sent, input, run };
}

describe("définition exportée", () => {
  it("reprend l'identité du catalogue et le schéma", () => {
    expect(definition).toMatchObject({ id: 7, slug: "07-monteur", name: "Monteur", promptFile: "prompt.md" });
  });
});

describe("monteur avec runAgent (faux LLM, fausse base)", () => {
  it("sortie valide : variables remplies, AgentRun complet, timeline normalisée enregistrée, passage au rendu", async () => {
    const ctx = setup([json(makeTimeline())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain(`Fichier voix : ${VOICE_URL}, durée réelle 12.1 s`);
    expect(system).toContain('niche: "objets du quotidien"');

    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 7,
      promptVersionId: "pv-7",
      bibleVersionId: "bible-1",
      inputTokens: 5000,
      outputTokens: 1800,
      cost: 0.06,
      input: { URL_VOIX: VOICE_URL, DUREE_VOIX_S: "12.1", STORYBOARD: expect.stringContaining("I-07") },
    });
    const saved = ctx.calls.saved[0];
    expect(saved?.pistes.sous_titres).toHaveLength(24);
    expect(saved?.export).toEqual({ largeur: 1080, hauteur: 1920, fps: 30, codec: "h264", audio: "aac_48k" });
    expect(saved?.duree_totale_s).toBeLessThanOrEqual(11.95 + MAX_TAIL_S);
    expect(ctx.store.runs[0]?.output).toEqual(saved);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.video.stage).toBe("RENDER");
  });

  it("sortie invalide trois fois : 3 AgentRun, NEEDS_FIX, alerte, rien d'enregistré", async () => {
    const gap = withClips((clips) => clips.map((clip) => (clip.plan === "P03" ? { ...clip, debut_s: 7 } : clip)));
    const ctx = setup(["pas du JSON", json({ ...makeTimeline(), export: { largeur: 720 } }), json(gap)]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("trou de 1 s entre P02 et P03");
    expect(ctx.store.needsFix.get(VIDEO_ID)).toContain("Monteur");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(ctx.calls.saved).toEqual([]);
  });

  it("contrôle refusé puis corrigé : le refus est renvoyé au modèle", async () => {
    const still = withClips((clips) => clips.map((clip) => (clip.plan === "P04" ? { ...clip, mouvement: "fixe" } : clip)));
    const ctx = setup([json(still), json(makeTimeline())]);
    expect(await ctx.run()).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("Plan fixe de plus de 3 s sans mouvement : P04");
  });

  it("plan sans fichier : timeline enregistrée (manquant), vidéo bloquée au montage avec la liste", async () => {
    const ctx = setup([json(makeTimeline())], { assets: makeAssets().filter((asset) => asset.planId !== "P02") });
    expect(await ctx.run()).toMatchObject({ status: "ok" });
    expect(ctx.calls.saved[0]?.pistes.video.find((clip) => clip.plan === "P02")).toMatchObject({ src: "", manquant: true });
    expect(ctx.calls.blocked).toEqual(["Monteur : Média manquant pour P02 : ajoute son fichier dans la page du directeur artistique (« Ajouter le fichier du plan »), puis relance l'étape."]);
    expect(ctx.calls.completed).toBe(0);
    expect(ctx.video).toMatchObject({ stage: "NEEDS_FIX", blockedAt: "EDIT" });
  });
});

describe("préconditions : aucun appel au modèle", () => {
  it.each([
    ["storyboard absent", { storyboard: null }, "Storyboard absent"],
    ["plan sonore illisible", { audio: { texte_tts: 3 } }, "Plan sonore illisible"],
    ["voix absente (aucune synthèse vocale branchée)", { audio: makeAudioPlan() }, NO_VOICE],
    ["horodatage absent", { audio: makeAudioJson({ words: [] }) }, NO_TIMINGS],
  ])("%s", async (_label, video, message) => {
    const ctx = setup([json(makeTimeline())], { video });
    await expect(ctx.run()).rejects.toThrow(AgentPreconditionError);
    await expect(ctx.run()).rejects.toThrow(message);
    expect(ctx.llm.requests).toEqual([]);
    expect(ctx.store.runs).toEqual([]);
  });

  it("tâche sans videoId", async () => {
    const editor = createEditorDefinition(() => makePorts().ports);
    await expect(editor.buildVariables({ jobId: "j", channelId: CHANNEL_ID, videoId: null, note: null, payload: null }, { channelId: CHANNEL_ID, videoId: null, bible: null, bibleVersionId: null })).rejects.toThrow(
      "pas de videoId",
    );
  });

  it("note de l'humain (renvoi depuis V3) : dans {{STORYBOARD}}, avec la timeline précédente", async () => {
    const ctx = setup([json(makeTimeline())], { note: "Le P02 arrive trop tard.", video: { timeline: makeTimeline({ alertes: ["ancienne"] }) } });
    await ctx.run();
    const storyboard = ctx.store.runs[0]?.input.STORYBOARD ?? "";
    expect(storyboard).toContain(`${CORRECTION_HEADING} :\nLe P02 arrive trop tard.`);
    expect(storyboard).toContain("ancienne");
  });
});

describe("onSuccess idempotent", () => {
  const timeline = normalizeTimeline(makeTimeline(), makeContext());

  it("rejoué après le passage au rendu : ne fait rien", async () => {
    const fake = makePorts();
    await recordTimeline(fake.ports, VIDEO_ID, timeline);
    await recordTimeline(fake.ports, VIDEO_ID, timeline);
    expect(fake.calls.saved).toHaveLength(1);
    expect(fake.calls.completed).toBe(1);
  });

  it.each(["RENDER", "QA", "NEEDS_FIX", "REJECTED"] as const)("vidéo en %s : rien n'est enregistré ni transité, sans erreur", async (stage) => {
    const fake = makePorts({ video: { stage } });
    await expect(recordTimeline(fake.ports, VIDEO_ID, timeline)).resolves.toBeUndefined();
    expect(fake.calls).toEqual({ saved: [], completed: 0, blocked: [], renders: 0 });
  });

  it("son changé pendant le montage (voix régénérée) : la timeline périmée n'est ni enregistrée ni envoyée au rendu", async () => {
    const fake = makePorts({ video: { audio: makeAudioJson() } });
    const outdated = { ...timeline, pistes: { ...timeline.pistes, audio: timeline.pistes.audio.map((clip) => (clip.type === "voix" ? { ...clip, src: "https://media.test/ancienne-voix.mp3" } : clip)) } };
    await recordTimeline(fake.ports, VIDEO_ID, outdated);
    expect(fake.calls).toMatchObject({ saved: [], completed: 0, blocked: [] });
    expect(usesOutdatedSound(timeline, { voice: { url: VOICE_URL, measuredS: 12, words: null }, music: null })).toBe(true);
    expect(usesOutdatedSound({ ...timeline, pistes: { ...timeline.pistes, audio: timeline.pistes.audio.filter((clip) => clip.type === "voix") } }, { voice: { url: VOICE_URL, measuredS: 12, words: null }, music: null })).toBe(false);
  });

  it("vidéo disparue : sans erreur", async () => {
    const fake = makePorts();
    fake.ports.loadVideo = async () => null;
    await expect(recordTimeline(fake.ports, VIDEO_ID, timeline)).resolves.toBeUndefined();
    expect(fake.calls.saved).toEqual([]);
  });

  it("transition refusée alors que la vidéo est toujours au montage : l'erreur remonte (le worker réessaiera)", async () => {
    const fake = makePorts({ failComplete: new Error("base indisponible") });
    await expect(recordTimeline(fake.ports, VIDEO_ID, timeline)).rejects.toThrow("base indisponible");
  });

  it("transition refusée parce que la vidéo a changé d'étape entre-temps : ignorée", async () => {
    const fake = makePorts({ failComplete: new Error("La vidéo a changé d'étape entre-temps") });
    const { loadVideo } = fake.ports;
    let calls = 0;
    fake.ports.loadVideo = async (videoId) => {
      calls += 1;
      const video = await loadVideo(videoId);
      return video && calls > 1 ? { ...video, stage: "REJECTED" } : video;
    };
    await expect(recordTimeline(fake.ports, VIDEO_ID, timeline)).resolves.toBeUndefined();
  });

  it("reprise après un crash entre la sortie acceptée et onSuccess : le modèle n'est pas rappelé", async () => {
    const ctx = setup([json(makeTimeline())]);
    const crashing = { ...ctx.editorDefinition, onSuccess: async () => Promise.reject(new Error("crash")) };
    const store = ctx.store;
    const notifier = { notify: async () => undefined };
    await expect(runAgent({ definition: crashing, input: ctx.input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "k" }, { store, llm: ctx.llm, notifier })).rejects.toThrow("crash");
    const resumed = await runAgent({ definition: ctx.editorDefinition, input: ctx.input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "k" }, { store, llm: ctx.llm, notifier });
    expect(resumed).toMatchObject({ status: "ok", reused: true });
    expect(ctx.llm.requests).toHaveLength(1);
    expect(ctx.calls.completed).toBe(1);
    expect(ctx.video.stage).toBe("RENDER");
  });
});
