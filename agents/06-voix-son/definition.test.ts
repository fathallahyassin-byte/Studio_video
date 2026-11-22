import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { outputSchema as qaAudioSchema } from "@/agents/06-voix-son/schema";
import type { AgentContext, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { Stage } from "@/lib/generated/prisma/client";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { makeStoryboard } from "@/agents/05-directeur-artistique/fixtures";
import { parseStoredAudioPlan } from "./audioPlan";
import { createAudioDefinition, definition, recordAudioPlan } from "./definition";
import { BIBLE_WITHOUT_VOICE, CUTS, makeOutput, makePorts, makeStt, makeTts, MANUAL_TRACK, STORYBOARD_EFFECTS, TEST_BIBLE, type PortOptions } from "./fixtures";
import { NO_LIBRARY } from "./music";
import { NO_TTS_REASON } from "./soundtrack";
import { CORRECTION_HEADING, NO_STORYBOARD, NO_TTS, NO_TTS_TAGS } from "./variables";

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
      return { text, inputTokens: 3000, outputTokens: 1200, cost: 0.05 };
    },
  };
}

function setup(answers: string[], options: PortOptions & { note?: string | null; bible?: string } = {}) {
  const fake = makePorts(options);
  const audioDefinition = createAudioDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 6, slug: "06-voix-son", name: "Voix et son", model: "modele-test", active: true, promptVersion: { id: "pv-6", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: options.bible ?? TEST_BIBLE });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: VIDEO_ID, note: options.note ?? null, payload: null };
  const run = () => runAgent({ definition: audioDefinition, input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "transition-1:agent-6" }, { store, llm, notifier });
  return { ...fake, audioDefinition, store, llm, sent, input, run };
}

const json = (value: unknown) => JSON.stringify(value);
const TTS_WITH_TAG = makeOutput().texte_tts.replace("dit.", 'dit. <break time="0.5s"/>');
const ctx: AgentContext = { channelId: CHANNEL_ID, videoId: VIDEO_ID, bible: TEST_BIBLE, bibleVersionId: "bible-1" };

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 6, slug: "06-voix-son", name: "Voix et son", promptFile: "prompt.md" });
  });
});

describe("voix et son avec runAgent (faux LLM, faux fournisseurs)", () => {
  it("sortie valide : variables remplies, AgentRun complet, voix et musique réglées, plan sonore enregistré, montage", async () => {
    const test = setup([json(makeOutput())]);
    const result = await test.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = test.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('"idee_id": "I-07"');
    expect(system).toContain("Moteur de synthèse vocale : faux-tts");
    expect(system).toContain('<break time="0.5s"/>');
    expect(system).toContain(NO_STORYBOARD);

    expect(test.store.runs).toHaveLength(1);
    expect(test.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 6,
      promptVersionId: "pv-6",
      bibleVersionId: "bible-1",
      inputTokens: 3000,
      outputTokens: 1200,
      cost: 0.05,
      input: { SCRIPT: expect.stringContaining("I-07"), TTS: "faux-tts" },
    });
    expect(test.voices.records).toHaveLength(1);
    expect(test.music.tracks).toEqual([expect.objectContaining({ titre: "Pizzicato curieux", licence: expect.stringContaining("commercial") })]);
    const saved = parseStoredAudioPlan(test.calls.saved[0]);
    expect(saved?.production).toMatchObject({
      duree_estimee_s: 24.5,
      duree_cible_s: [20, 30],
      voix: { url: "https://voix.test/voix-1.mp3", voix_id: "voix-claire", langue: "fr-FR", duree_s: 24.5, horodatage: "tts", coupes_appliquees: [] },
      musique: { source: "banque", fournisseur: "fausse-banque" },
    });
    expect(saved?.production.voix.mots).toHaveLength(49);
    expect(test.calls.completed).toBe(1);
    expect(test.video.stage).toBe("EDIT");
  });

  it("le plan enregistré reste lisible par le contrôle qualité (texte_tts, schéma de la sortie)", async () => {
    const test = setup([json(makeOutput())]);
    await test.run();
    expect(qaAudioSchema.parse(test.calls.saved[0]).texte_tts).toContain("mille huit cent");
  });

  it("enregistre le mixage recalculé en code, pas celui du modèle", async () => {
    const test = setup([json(makeOutput({ mixage: { cible_lufs: -8, musique_sous_voix_db: 20, ducking: false } }))]);
    await test.run();
    expect(test.store.runs[0]?.output).toMatchObject({ mixage: { cible_lufs: -14, musique_sous_voix_db: -20, ducking: true } });
  });

  it("sortie invalide trois fois : 3 AgentRun, NEEDS_FIX, alerte, aucune voix ni plan enregistré", async () => {
    const test = setup(["pas du JSON", json({ ...makeOutput(), effets: "aucun" }), json(makeOutput({ texte_tts: "Né en 1899, il a tout changé et plus personne ne s'en souvient vraiment aujourd'hui." }))]);
    const result = await test.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(test.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(test.store.runs[2]?.error).toContain("1899");
    expect(test.store.needsFix.get(VIDEO_ID)).toContain("Voix et son");
    expect(test.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(test.voices.records).toEqual([]);
    expect(test.calls.saved).toEqual([]);
  });

  it("refus en code renvoyé au modèle, puis correction acceptée", async () => {
    const test = setup([json(makeOutput({ effets: makeOutput().effets.slice(0, 2) })), json(makeOutput())]);
    const result = await test.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(test.llm.requests[1]?.messages.at(-1)?.content).toContain("2 effets sonores : il en faut de 4 à 8");
  });

  it("avec un storyboard : il est donné au modèle et les effets doivent viser ses plans", async () => {
    const test = setup([json(makeOutput()), json(makeOutput({ effets: STORYBOARD_EFFECTS }))], { video: { storyboard: makeStoryboard() } });
    const result = await test.run();
    expect(test.llm.requests[0]?.system).toContain('"id": "P08"');
    expect(test.store.runs[0]?.error).toContain("n'existe pas dans le storyboard");
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
  });

  it("aucun TTS branché : le modèle en est prévenu, puis la vidéo est bloquée avec une alerte claire, sans audioJson", async () => {
    const test = setup([json(makeOutput())], { tts: null });
    const result = await test.run();
    const system = test.llm.requests[0]?.system ?? "";
    expect(system).toContain(NO_TTS);
    expect(system).toContain(NO_TTS_TAGS);
    expect(result).toMatchObject({ status: "ok" });
    expect(test.calls.blocked).toEqual([expect.stringContaining(NO_TTS_REASON)]);
    expect(test.calls.saved).toEqual([]);
    expect(test.video.stage).toBe("NEEDS_FIX");
  });

  it("sans TTS, une balise dans le texte est refusée (ponctuation seulement)", async () => {
    const tagged = makeOutput({ texte_tts: TTS_WITH_TAG });
    const test = setup([json(tagged), json(makeOutput())], { tts: null });
    await test.run();
    expect(test.store.runs[0]?.error).toContain("aucun moteur n'en accepte");
  });
});

describe("après la sortie : durée réelle, musique, budget", () => {
  const run = (options: PortOptions, output = makeOutput(), bible = TEST_BIBLE) => {
    const fake = makePorts(options);
    return { ...fake, done: recordAudioPlan(fake.ports, VIDEO_ID, output, { bible }) };
  };

  it("voix trop longue : les coupes proposées sont appliquées en code et la voix régénérée une seule fois", async () => {
    const tts = makeTts({ durationOf: (text) => text.split(" ").length * 0.7 });
    const test = run({ tts });
    await test.done;
    expect(tts.requests).toHaveLength(2);
    expect(tts.requests[1]?.text).not.toContain("Norvégien");
    const saved = parseStoredAudioPlan(test.calls.saved[0]);
    expect(saved?.production.voix.coupes_appliquees).toEqual(CUTS);
    expect(saved?.texte_tts).toBe(tts.requests[1]?.text);
    expect(test.video.stage).toBe("EDIT");
  });

  it("voix trop longue même après les coupes : blocage, aucune seconde génération inutile", async () => {
    const tts = makeTts({ durationOf: (text) => text.split(" ").length * 1.5 });
    const test = run({ tts });
    await test.done;
    expect(tts.requests).toHaveLength(1);
    expect(test.calls.blocked[0]).toContain("voix trop longue");
    expect(test.calls.saved).toEqual([]);
  });

  it("voix trop courte : blocage avec la durée mesurée", async () => {
    const tts = makeTts({ durationOf: () => 12 });
    const test = run({ tts });
    await test.done;
    expect(test.calls.blocked[0]).toContain("voix trop courte : 12 s");
  });

  it("moteur sans horodatage : Whisper prend le relais", async () => {
    const stt = makeStt();
    const test = run({ tts: makeTts({ withWords: false }), stt });
    await test.done;
    expect(stt.requests).toEqual(["https://voix.test/voix-1.mp3"]);
    expect(parseStoredAudioPlan(test.calls.saved[0])?.production.voix.horodatage).toBe("stt");
  });

  it("moteur sans horodatage et pas de Whisper : blocage", async () => {
    const test = run({ tts: makeTts({ withWords: false }) });
    await test.done;
    expect(test.calls.blocked[0]).toContain("horodatage");
  });

  it("aucune banque de musique et aucun choix de l'humain : blocage avant toute génération payante", async () => {
    const tts = makeTts();
    const test = run({ tts, library: null });
    await test.done;
    expect(tts.requests).toEqual([]);
    expect(test.calls.blocked[0]).toContain(NO_LIBRARY);
  });

  it("piste choisie par l'humain dans le panneau : utilisée sans banque", async () => {
    const test = run({ library: null, manual: MANUAL_TRACK });
    await test.done;
    expect(parseStoredAudioPlan(test.calls.saved[0])?.production.musique).toEqual(MANUAL_TRACK);
  });

  it("budget dépassé : rien n'est généré, blocage avec l'estimation", async () => {
    const tts = makeTts();
    const test = run({ tts, video: { totalCost: 4.99 } });
    await test.done;
    expect(tts.requests).toEqual([]);
    expect(test.calls.blocked[0]).toContain("il reste 0,01 €");
  });

  it("BUDGET_PAR_VIDEO absent : génération payante refusée", async () => {
    const test = run({ perVideo: undefined });
    await test.done;
    expect(test.calls.blocked[0]).toContain("BUDGET_PAR_VIDEO");
  });

  it("identité de la voix absente de la bible : blocage", async () => {
    const test = run({}, makeOutput(), BIBLE_WITHOUT_VOICE);
    await test.done;
    expect(test.calls.blocked[0]).toContain("identite.voix");
  });

  it("storyboard pas encore enregistré : le plan sonore est écrit, la vidéo attend l'agent 5", async () => {
    const fake = makePorts();
    fake.ports.completeMedia = async () => {
      fake.calls.completed += 1;
    };
    await recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE });
    expect(fake.calls.saved).toHaveLength(1);
    expect(fake.video.stage).toBe("VISUALS_AND_AUDIO");
  });
});

describe("buildVariables", () => {
  it("note de l'humain : ajoutée à {{SCRIPT}} avec le plan sonore précédent", async () => {
    const test = setup([json(makeOutput())], { note: "Voix trop rapide.", latestOutput: makeOutput({ texte_tts: "Version précédente du texte." }) });
    await test.run();
    const script = test.store.runs[0]?.input.SCRIPT ?? "";
    expect(script).toContain(`${CORRECTION_HEADING} :\nVoix trop rapide.`);
    expect(script).toContain("Version précédente du texte.");
  });

  it.each([
    ["sans script", { video: { script: null } }, /pas de script/],
    ["script illisible", { video: { script: { beats: [] } } }, /illisible/],
    ["vidéo introuvable", { exists: false }, /introuvable/],
  ] as const)("%s : précondition, aucun appel au modèle", async (_label, options, message) => {
    const test = setup([json(makeOutput())], options);
    await expect(test.run()).rejects.toThrow(AgentPreconditionError);
    await expect(test.run()).rejects.toThrow(message);
    expect(test.llm.requests).toEqual([]);
    expect(test.store.runs).toEqual([]);
  });

  it("bible sans durée cible : précondition, aucun appel", async () => {
    const test = setup([json(makeOutput())], { bible: TEST_BIBLE.replace("debit_voix_mots_par_s: 2", "") });
    await expect(test.run()).rejects.toThrow(/Bible inutilisable/);
    expect(test.llm.requests).toEqual([]);
  });

  it("refuse une tâche sans vidéo", async () => {
    const test = setup([]);
    await expect(test.audioDefinition.buildVariables({ ...test.input, videoId: null }, { ...ctx, videoId: null })).rejects.toThrow(AgentPreconditionError);
  });
});

describe("onSuccess idempotent", () => {
  it("rejoué après la transition, il ne refait rien", async () => {
    const test = setup([]);
    await test.audioDefinition.onSuccess(makeOutput(), test.input, ctx);
    await test.audioDefinition.onSuccess(makeOutput(), test.input, ctx);
    expect(test.voices.records).toHaveLength(1);
    expect(test.calls.completed).toBe(1);
    expect(test.calls.saved).toHaveLength(1);
  });

  it.each<Stage>(["EDIT", "NEEDS_FIX", "REJECTED", "AWAITING_V2"])("vidéo déjà en %s : ni génération, ni enregistrement, ni erreur", async (stage) => {
    const fake = makePorts({ stage });
    await expect(recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE })).resolves.toBeUndefined();
    expect(fake.voices.records).toEqual([]);
    expect(fake.calls).toMatchObject({ saved: [], completed: 0, blocked: [] });
  });

  it("vidéo supprimée : ne lève pas d'erreur", async () => {
    const fake = makePorts({ exists: false });
    await expect(recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE })).resolves.toBeUndefined();
  });

  it("crash après la voix payée : la reprise retrouve la voix sans la régénérer", async () => {
    const fake = makePorts();
    const tts = fake.ports.tools.tts;
    if (!tts) throw new Error("tts attendu");
    let crashed = false;
    const original = fake.ports.music.recordTrack;
    fake.ports.music.recordTrack = async (...args) => {
      if (!crashed) {
        crashed = true;
        throw new Error("panne de la base");
      }
      return original(...args);
    };
    await expect(recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE })).rejects.toThrow("panne");
    await recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE });
    expect(fake.voices.records).toHaveLength(1);
    expect(fake.calls.completed).toBe(1);
  });

  it("l'agent 5 fait avancer la vidéo pendant la génération : pas d'erreur, pas d'écriture", async () => {
    const fake = makePorts();
    const tts = fake.ports.tools.tts;
    if (!tts) throw new Error("tts attendu");
    const synthesize = tts.synthesize.bind(tts);
    fake.ports.tools.tts = {
      ...tts,
      synthesize: async (request) => {
        const result = await synthesize(request);
        fake.video.stage = "EDIT";
        return result;
      },
    };
    await expect(recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE })).resolves.toBeUndefined();
    expect(fake.calls.saved).toEqual([]);
    expect(fake.calls.completed).toBe(0);
  });
});
