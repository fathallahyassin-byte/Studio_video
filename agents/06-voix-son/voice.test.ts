import { describe, expect, it } from "vitest";
import { CUTS, makeStt, makeTts, makeVoiceStore, TTS_TEXT } from "./fixtures";
import { fitVoice, pendingVoiceCost, produceVoice, voiceKey, type VoiceJob } from "./voice";

const job = (changes: Partial<VoiceJob> = {}): VoiceJob => ({
  videoId: "video-1",
  text: TTS_TEXT,
  voiceId: "voix-claire",
  language: "fr-FR",
  attempt: 1,
  remainingBudget: 5,
  isStillActive: async () => true,
  ...changes,
});

describe("clé d'idempotence", () => {
  it("dépend de la vidéo, de la tentative et de la requête", () => {
    const request = { text: "Bonjour.", voiceId: "v", speed: 1 };
    expect(voiceKey("a", 1, request)).toBe(voiceKey("a", 1, { ...request }));
    expect(voiceKey("a", 1, request)).not.toBe(voiceKey("a", 2, request));
    expect(voiceKey("a", 1, request)).not.toBe(voiceKey("a", 1, { ...request, text: "Salut." }));
  });
});

describe("produceVoice", () => {
  it("génère, enregistre, puis retrouve la voix sans la repayer", async () => {
    const tts = makeTts();
    const store = makeVoiceStore();
    const first = await produceVoice(store, { tts, stt: null }, job());
    const second = await produceVoice(store, { tts, stt: null }, job());
    expect(first).toMatchObject({ status: "done", reused: false, cost: 0.049 });
    expect(second).toMatchObject({ status: "done", reused: true, cost: 0 });
    expect(tts.requests).toHaveLength(1);
    expect(await pendingVoiceCost(store, tts, job())).toBe(0);
  });

  it("vérifie le budget avant de payer", async () => {
    const tts = makeTts();
    expect(await produceVoice(makeVoiceStore(), { tts, stt: null }, job({ remainingBudget: 0.01 }))).toEqual({ status: "over_budget", estimate: 0.049, remaining: 0.01 });
    expect(await produceVoice(makeVoiceStore(), { tts, stt: null }, job({ remainingBudget: null }))).toEqual({ status: "no_budget" });
    expect(tts.requests).toEqual([]);
  });

  it("vidéo sortie de l'étape : rien n'est généré", async () => {
    const tts = makeTts();
    expect(await produceVoice(makeVoiceStore(), { tts, stt: null }, job({ isStillActive: async () => false }))).toEqual({ status: "stopped" });
    expect(tts.requests).toEqual([]);
  });

  it("Whisper passe une fois, même après une reprise", async () => {
    const tts = makeTts({ withWords: false });
    const stt = makeStt();
    const store = makeVoiceStore();
    const first = await produceVoice(store, { tts, stt }, job());
    await produceVoice(store, { tts, stt }, job());
    expect(first).toMatchObject({ status: "done", cost: expect.closeTo(0.051), voice: { timingSource: "stt" } });
    expect(stt.requests).toHaveLength(1);
    expect(store.timings).toHaveLength(1);
  });
});

describe("fitVoice : durée réelle hors cible", () => {
  const target = { minS: 20, maxS: 30 };

  it("dans la cible : une seule génération, aucune coupe", async () => {
    const tts = makeTts();
    const outcome = await fitVoice(makeVoiceStore(), { tts, stt: null }, { ...job(), cuts: CUTS, target });
    expect(outcome).toMatchObject({ status: "ok", fitted: { appliedCuts: [], text: TTS_TEXT } });
  });

  it("trop longue sans coupe proposée : refus explicite", async () => {
    const tts = makeTts({ durationOf: () => 40 });
    const outcome = await fitVoice(makeVoiceStore(), { tts, stt: null }, { ...job(), cuts: [], target });
    expect(outcome).toMatchObject({ status: "refused", reason: expect.stringContaining("aucune coupe proposée") });
  });

  it("la seconde génération respecte le budget restant", async () => {
    const tts = makeTts({ durationOf: (text) => text.split(" ").length * 0.7 });
    const outcome = await fitVoice(makeVoiceStore(), { tts, stt: null }, { ...job({ remainingBudget: 0.06 }), cuts: CUTS, target });
    expect(outcome).toMatchObject({ status: "refused", reason: expect.stringContaining("il reste 0,01 €") });
    expect(tts.requests).toHaveLength(1);
  });

  it("encore trop longue après les coupes : refus", async () => {
    const tts = makeTts({ durationOf: (text) => (text.includes("Norvégien") ? 34.3 : 31) });
    const outcome = await fitVoice(makeVoiceStore(), { tts, stt: null }, { ...job(), cuts: CUTS, target });
    expect(outcome).toMatchObject({ status: "refused", reason: expect.stringContaining("voix coupée encore hors cible : 31 s") });
    expect(tts.requests).toHaveLength(2);
  });
});
