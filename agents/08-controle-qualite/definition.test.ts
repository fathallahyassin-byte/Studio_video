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
import { createQaDefinition, definition, recordReport } from "./definition";
import { FULL_EVIDENCE, koCheck, makeReport, makeVideo, NO_EVIDENCE, TEST_BIBLE, withCheck } from "./fixtures";
import type { PublishedVideo, QaAsset, QaPorts, QaVideo, RenderEvidence } from "./ports";
import { UNVERIFIED_PREFIX } from "./rules";
import type { Output } from "./schema";
import { NO_HISTORY, NOTE_HEADING } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const VIDEO_ID = "video-1";
const CHANNEL_ID = "chaine-1";

type PortOptions = { exists?: boolean; video?: Partial<QaVideo>; evidence?: RenderEvidence; assets?: QaAsset[]; published?: PublishedVideo[] };

/** Vidéo en mémoire : les transitions changent l'étape comme le ferait lib/pipeline. */
function makePorts(options: PortOptions = {}) {
  const video = makeVideo(options.video);
  const calls = { saved: [] as Output[], passed: 0, blocked: [] as string[], historyLimit: 0 };
  const ports: QaPorts = {
    async loadVideo() {
      return options.exists === false ? null : { ...video };
    },
    async loadAssets() {
      return options.assets ?? [];
    },
    async loadRenderEvidence() {
      return options.evidence ?? FULL_EVIDENCE;
    },
    async loadPublishedVideos(_channelId, limit) {
      calls.historyLimit = limit;
      return options.published ?? [];
    },
    async saveReport(_videoId, report) {
      calls.saved.push(report);
      video.previousReport = report;
    },
    async passQa() {
      if (video.stage !== "QA") throw new Error("transition impossible");
      calls.passed += 1;
      video.stage = "AWAITING_V3";
    },
    async blockQa(_videoId, reason) {
      if (video.stage !== "QA") throw new Error("transition impossible");
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
      return { text, inputTokens: 4000, outputTokens: 1200, cost: 0.07 };
    },
  };
}

function setup(answers: string[], options: PortOptions & { note?: string | null } = {}) {
  const fake = makePorts(options);
  const qaDefinition = createQaDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 8, slug: "08-controle-qualite", name: "Contrôle qualité", model: "modele-test", active: true, promptVersion: { id: "pv-8", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: TEST_BIBLE });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: VIDEO_ID, note: options.note ?? null, payload: null };
  const run = () => runAgent({ definition: qaDefinition, input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "transition-1:agent-8" }, { store, llm, notifier });
  return { ...fake, qaDefinition, store, llm, sent, input, run };
}

const json = (value: unknown) => JSON.stringify(value);
const callCtx: AgentContext = { channelId: CHANNEL_ID, videoId: VIDEO_ID, bible: TEST_BIBLE, bibleVersionId: "bible-1" };

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 8, slug: "08-controle-qualite", name: "Contrôle qualité", promptFile: "prompt.md" });
  });
});

describe("contrôle qualité avec runAgent (faux LLM)", () => {
  it("sortie valide : 10 variables remplies, AgentRun complet, rapport enregistré, vidéo en attente de V3", async () => {
    const ctx = setup([json(makeReport())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('niche: "objets du quotidien"');
    expect(system).toContain('"texte_tts"');
    expect(system).toContain("Partenariat commercial : aucun");
    expect(system).toContain(NO_HISTORY);
    expect(ctx.calls.historyLimit).toBe(10);

    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 8,
      promptVersionId: "pv-8",
      bibleVersionId: "bible-1",
      inputTokens: 4000,
      outputTokens: 1200,
      cost: 0.07,
      input: {
        DOSSIER: expect.stringContaining("F2"),
        SCRIPT: expect.stringContaining("trombone"),
        STORYBOARD: expect.stringContaining("image_ia_animee"),
        PLAN_SONORE: expect.stringContaining("cible_lufs"),
        TIMELINE: expect.stringContaining("duree_totale_s"),
        TRANSCRIPTION: expect.stringContaining("secret industriel"),
        CAPTURES: expect.stringContaining("1. Gros plan"),
        PARTENARIAT: "aucun",
        HISTORIQUE: NO_HISTORY,
      },
    });
    expect(ctx.calls.saved).toEqual([makeReport()]);
    expect(ctx.calls.passed).toBe(1);
    expect(ctx.video.stage).toBe("AWAITING_V3");
  });

  it("le modèle dit GO mais un point A est ko : décision recalculée NO_GO, vidéo bloquée et renvoyée à l'agent responsable", async () => {
    const report = withCheck("A2", koCheck("Remettre 1899 au lieu de 1901", "04-scenariste"), makeReport({ decision: "GO" }));
    const ctx = setup([json(report)]);
    await ctx.run();
    expect(ctx.calls.saved[0]?.decision).toBe("NO_GO");
    expect(ctx.store.runs[0]?.output).toMatchObject({ decision: "NO_GO" });
    expect(ctx.calls.passed).toBe(0);
    expect(ctx.calls.blocked).toEqual(["Contrôle qualité : NO-GO, renvoyé à 04-scenariste. Points ko : A2 : Remettre 1899 au lieu de 1901"]);
    expect(ctx.video.stage).toBe("NEEDS_FIX");
  });

  it("GO_AVEC_CORRECTIONS : passe en V3 avec le rapport", async () => {
    const ctx = setup([json(withCheck("E4", koCheck("Boucler sur le mot trombone", "04-scenariste"), makeReport({ decision: "GO_AVEC_CORRECTIONS" })))]);
    await ctx.run();
    expect(ctx.calls.saved[0]?.decision).toBe("GO_AVEC_CORRECTIONS");
    expect(ctx.video.stage).toBe("AWAITING_V3");
  });

  it("sortie invalide trois fois : 3 AgentRun, vidéo en NEEDS_FIX, aucun rapport enregistré", async () => {
    const missingD5 = makeReport({ controles: makeReport().controles.filter((check) => check.id !== "D5") });
    const ctx = setup(["pas du JSON", json({ ...makeReport(), decision: "PEUT-ÊTRE" }), json(missingD5)]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("points manquants : D5");
    expect(ctx.store.needsFix.get(VIDEO_ID)).toContain("Contrôle qualité");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(ctx.calls.saved).toEqual([]);
    expect(ctx.calls.passed + ctx.calls.blocked.length).toBe(0);
  });

  it("étiquette TikTok oubliée malgré la voix de synthèse : refusée, renvoyée au modèle, puis correction acceptée", async () => {
    const wrong = makeReport({ etiquettes: { ...makeReport().etiquettes, tiktok_contenu_ia: false } });
    const ctx = setup([json(wrong), json(makeReport())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("tiktok_contenu_ia doit être true");
  });
});

describe("données pas encore produites", () => {
  it("sans transcription ni captures : variables « NON DISPONIBLE », points concernés forcés en ko, NO_GO", async () => {
    const ctx = setup([json(makeReport())], { evidence: NO_EVIDENCE });
    await ctx.run();
    const input = ctx.store.runs[0]?.input;
    expect(input?.TRANSCRIPTION).toMatch(/^NON DISPONIBLE : transcription Whisper du rendu n'a pas été produit\(e\)/);
    expect(input?.TRANSCRIPTION).toContain("Les points A1, A2, E2, F1 sont marqués « ko » (non vérifié)");
    expect(input?.CAPTURES).toContain("Les points C2, E4");
    const saved = ctx.calls.saved[0];
    const forced = saved?.controles.filter((check) => check.preuve.startsWith(UNVERIFIED_PREFIX)).map((check) => check.id);
    expect(forced).toEqual(["A1", "A2", "C2", "E2", "E4", "F1"]);
    expect(saved?.decision).toBe("NO_GO");
    expect(ctx.calls.blocked[0]).toContain("renvoyé à 08-controle-qualite");
  });

  it("storyboard, plan sonore et timeline absents ou illisibles : texte explicite, jamais de JSON inventé", async () => {
    const ctx = setup([json(makeReport())], { video: { storyboard: null, audio: { texte: "ancien format" }, timeline: null } });
    await ctx.run();
    const input = ctx.store.runs[0]?.input;
    expect(input?.STORYBOARD).toContain("NON DISPONIBLE : storyboard (agent 5) n'a pas été produit(e)");
    expect(input?.PLAN_SONORE).toContain("NON DISPONIBLE : plan sonore (agent 6) est illisible");
    expect(input?.TIMELINE).toContain("NON DISPONIBLE : timeline (agent 7)");
    const statuses = Object.fromEntries((ctx.calls.saved[0]?.controles ?? []).map((check) => [check.id, check.statut]));
    expect(statuses).toMatchObject({ B1: "ok", B2: "ko", C1: "ko", D1: "ko", D2: "ko", D3: "na", D4: "na", D5: "ko", E1: "ko", E3: "ko" });
  });

  it("médias enregistrés : fournisseur et licence ajoutés au storyboard et au plan sonore", async () => {
    const assets: QaAsset[] = [
      { type: "MUSIC", provider: "banque-audio", license: "commerciale, perpétuelle", planId: null },
      { type: "IMAGE", provider: "image-ia", license: null, planId: "P1" },
    ];
    const ctx = setup([json(makeReport())], { assets });
    await ctx.run();
    expect(ctx.store.runs[0]?.input.PLAN_SONORE).toContain("- MUSIC · fournisseur : banque-audio · licence : commerciale, perpétuelle");
    expect(ctx.store.runs[0]?.input.STORYBOARD).toContain("- IMAGE P1 · fournisseur : image-ia · licence non renseignée");
  });
});

describe("buildVariables", () => {
  it("partenariat : champ de la vidéo, avec contenu de marque et mention imposés", async () => {
    const report = makeReport({
      etiquettes: { ...makeReport().etiquettes, contenu_de_marque: true },
      mentions_a_incruster: ["Collaboration commerciale", "Images virtuelles"],
      controles: makeReport().controles.map((check) => (check.id === "D3" || check.id === "D4" ? { ...check, statut: "ok" as const, preuve: "Mention présente." } : check)),
    });
    const ctx = setup([json(makeReport()), json(report)], { video: { partnership: "  Marque X, produit offert " } });
    const result = await ctx.run();
    expect(ctx.store.runs[0]?.input.PARTENARIAT).toBe("Marque X, produit offert");
    expect(ctx.store.runs[0]?.error).toContain("contenu_de_marque doit être true");
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
  });

  it("historique : un résumé compact par vidéo publiée", async () => {
    const published: PublishedVideo[] = [
      { number: 12, title: "Le crayon jaune", script: makeVideo().script, storyboard: makeVideo().storyboard },
      { number: 9, title: "Vieux format", script: { ancien: true }, storyboard: null },
    ];
    const ctx = setup([json(makeReport())], { published });
    await ctx.run();
    const history = ctx.store.runs[0]?.input.HISTORIQUE ?? "";
    expect(history).toContain("- V-012 « Le crayon jaune » · accroche (affirmation) : « Ton trombone cache un secret industriel. » · structure : accroche → contexte → revelation → chute → boucle · plans : image_ia_animee ×1, texte_anime ×1");
    expect(history).toContain("- V-009 « Vieux format » · structure inconnue (script illisible)");
  });

  it("note de l'humain (renvoi depuis V3) : ajoutée sous un intitulé, avec le rapport précédent", async () => {
    const previous = withCheck("E2", koCheck("Remonter les sous-titres", "07-monteur"), makeReport({ decision: "GO_AVEC_CORRECTIONS" }));
    const ctx = setup([json(makeReport())], { note: "Revérifie les sous-titres de la fin.", video: { previousReport: previous } });
    await ctx.run();
    const history = ctx.store.runs[0]?.input.HISTORIQUE ?? "";
    expect(history).toContain(`${NOTE_HEADING} :\nRevérifie les sous-titres de la fin.`);
    expect(history).toContain("Rapport précédent : GO_AVEC_CORRECTIONS.\n- E2 : Problème constaté. → correction : Remonter les sous-titres");
  });

  it.each([
    ["sans dossier", { video: { dossier: null } }, /pas de dossier factuel/],
    ["dossier illisible", { video: { dossier: { faits: [] } } }, /dossier factuel de la vidéo est illisible/],
    ["sans script", { video: { script: null } }, /pas de script/],
    ["script illisible", { video: { script: { beats: [] } } }, /script de la vidéo est illisible/],
    ["vidéo introuvable", { exists: false }, /introuvable/],
  ] as const)("%s : précondition, aucun appel au modèle", async (_label, options, message) => {
    const ctx = setup([json(makeReport())], options);
    await expect(ctx.run()).rejects.toThrow(AgentPreconditionError);
    await expect(ctx.run()).rejects.toThrow(message);
    expect(ctx.llm.requests).toEqual([]);
    expect(ctx.store.runs).toEqual([]);
  });

  it("refuse une tâche sans vidéo", async () => {
    const ctx = setup([]);
    await expect(ctx.qaDefinition.buildVariables({ ...ctx.input, videoId: null }, callCtx)).rejects.toThrow(AgentPreconditionError);
  });

  it("normalize lit la durée cible dans la bible de l'appel", async () => {
    const ctx = setup([], { video: { timeline: makeVideo({}).timeline } });
    const shorter = TEST_BIBLE.replace("duree_cible_s: [20, 30]", "duree_cible_s: [10, 20]");
    const normalized = await ctx.qaDefinition.normalize?.(makeReport(), ctx.input, { ...callCtx, bible: shorter });
    expect(normalized?.controles.find((check) => check.id === "E1")).toMatchObject({ statut: "ko", preuve: expect.stringContaining("(10 à 20 s)") });
    expect(normalized?.decision).toBe("GO_AVEC_CORRECTIONS");
  });
});

describe("onSuccess idempotent", () => {
  it("rejoué après la transition, il ne refait rien", async () => {
    const fake = setup([]);
    await fake.qaDefinition.onSuccess(makeReport(), fake.input, callCtx);
    await fake.qaDefinition.onSuccess(makeReport(), fake.input, callCtx);
    expect(fake.calls.passed).toBe(1);
    expect(fake.calls.saved).toHaveLength(1);
  });

  it.each<Stage>(["AWAITING_V3", "NEEDS_FIX", "REJECTED", "SCHEDULED", "EDIT"])("vidéo déjà en %s : ni enregistrement, ni transition, ni erreur", async (stage) => {
    const { ports, calls } = makePorts({ video: { stage } });
    await expect(recordReport(ports, VIDEO_ID, makeReport())).resolves.toBeUndefined();
    expect(calls).toMatchObject({ saved: [], passed: 0, blocked: [] });
  });

  it("vidéo supprimée : ne lève pas d'erreur", async () => {
    const { ports, calls } = makePorts({ exists: false });
    await expect(recordReport(ports, VIDEO_ID, makeReport())).resolves.toBeUndefined();
    expect(calls.saved).toEqual([]);
  });

  it("transition refusée parce que l'humain a déplacé la vidéo entre-temps : pas d'erreur", async () => {
    const fake = makePorts();
    const racing: QaPorts = {
      ...fake.ports,
      async blockQa() {
        fake.video.stage = "REJECTED";
        throw new Error("La vidéo a changé d'étape entre-temps : recharge la page.");
      },
    };
    await expect(recordReport(racing, VIDEO_ID, withCheck("C2", koCheck("Flouter le logo", "05-directeur-artistique"), makeReport({ decision: "NO_GO" })))).resolves.toBeUndefined();
  });

  it("runAgent rejoue onSuccess après un crash sans rappeler le modèle, et la transition est faite une fois", async () => {
    const run = setup([json(makeReport())]);
    const original = run.ports.passQa;
    run.ports.passQa = async () => {
      throw new Error("crash du worker");
    };
    await expect(run.run()).rejects.toThrow("crash du worker");
    expect(run.video.stage).toBe("QA");
    run.ports.passQa = original;
    const result = await run.run();
    expect(result).toMatchObject({ status: "ok", reused: true });
    expect(run.llm.requests).toHaveLength(1);
    expect(run.calls.passed).toBe(1);
    expect(run.video.stage).toBe("AWAITING_V3");
  });
});
