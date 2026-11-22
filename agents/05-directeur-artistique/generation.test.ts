import { describe, expect, it } from "vitest";
import { makeImageProvider, makeMediaPorts, makePlan, makePlans, makePorts, makeStoryboard, makeVideoProvider } from "./fixtures";
import { buildJobs, generateMedia, generationKey } from "./generation";
import { regeneratePlan } from "./regenerate";

const VIDEO_ID = "video-1";
const active = async () => true;

describe("buildJobs", () => {
  it("une génération par plan image ou vidéo IA, aucune pour le texte animé et le stock", () => {
    const result = buildJobs(VIDEO_ID, makePlans(), { image: makeImageProvider(), video: makeVideoProvider() });
    expect(result.ok && result.jobs.map((job) => `${job.plan.id}:${job.kind}`)).toEqual(["P01:VIDEO", "P02:IMAGE", "P05:IMAGE", "P06:IMAGE", "P08:VIDEO"]);
  });

  it("requête vidéo : durée du plan, format 9:16, prompt et négatif du storyboard", () => {
    const result = buildJobs(VIDEO_ID, [makePlan("P01", 1, 0, 2.5, "video_ia")], { image: null, video: makeVideoProvider() });
    expect(result.ok && result.jobs[0]?.request).toEqual({
      prompt: expect.stringContaining("vertical 9:16 composition"),
      negativePrompt: "text, logo, watermark, real person",
      durationS: 2.5,
      aspectRatio: "9:16",
    });
  });

  it("liste les plans sans générateur", () => {
    expect(buildJobs(VIDEO_ID, makePlans(), { image: makeImageProvider(), video: null })).toEqual({ ok: false, missing: ["P01", "P08"] });
  });

  it("clé : même vidéo, plan, tentative et requête = même clé ; un prompt ou une tentative différents changent la clé", () => {
    const request = { prompt: "a", negativePrompt: null, aspectRatio: "9:16" as const };
    expect(generationKey(VIDEO_ID, "P01", 1, request)).toBe(generationKey(VIDEO_ID, "P01", 1, { ...request }));
    expect(generationKey(VIDEO_ID, "P01", 1, request)).toMatch(/^video-1:P01:1:[0-9a-f]{12}$/);
    expect(generationKey(VIDEO_ID, "P01", 1, request)).not.toBe(generationKey(VIDEO_ID, "P01", 1, { ...request, prompt: "b" }));
    expect(generationKey(VIDEO_ID, "P01", 1, request)).not.toBe(generationKey(VIDEO_ID, "P01", 2, request));
  });
});

describe("generateMedia", () => {
  it("génère tout puis ne régénère rien au second passage", async () => {
    const media = makeMediaPorts({ image: makeImageProvider(), video: makeVideoProvider() });
    const first = await generateMedia(media, { videoId: VIDEO_ID, plans: makePlans(), remainingBudget: 5, isStillActive: active });
    expect(first).toEqual({ status: "done", generated: 5, reused: 0, cost: expect.closeTo(0.72, 5) });
    const second = await generateMedia(media, { videoId: VIDEO_ID, plans: makePlans(), remainingBudget: 5, isStillActive: active });
    expect(second).toEqual({ status: "done", generated: 0, reused: 5, cost: 0 });
    expect(media.records).toHaveLength(5);
  });

  it("estime seulement ce qui reste à générer", async () => {
    const media = makeMediaPorts({ image: makeImageProvider(), video: makeVideoProvider() });
    await generateMedia(media, { videoId: VIDEO_ID, plans: makePlans().slice(0, 2), remainingBudget: 5, isStillActive: active });
    const outcome = await generateMedia(media, { videoId: VIDEO_ID, plans: makePlans(), remainingBudget: 0.4, isStillActive: active });
    // Il reste P05, P06 (images à 0,04 €) et P08 (vidéo de 3 s à 0,10 €/s) : 0,38 € pour 0,40 € disponibles.
    expect(outcome).toEqual({ status: "done", generated: 3, reused: 2, cost: expect.closeTo(0.38, 5) });
  });

  it("au-delà du budget : rien n'est généré", async () => {
    const image = makeImageProvider();
    const media = makeMediaPorts({ image, video: makeVideoProvider() });
    const outcome = await generateMedia(media, { videoId: VIDEO_ID, plans: makePlans(), remainingBudget: 0.5, isStillActive: active });
    expect(outcome).toEqual({ status: "over_budget", estimate: expect.closeTo(0.72, 5), remaining: 0.5 });
    expect(image.requests).toEqual([]);
  });
});

describe("regeneratePlan", () => {
  it("nouvelle tentative avec le prompt modifié, enregistrée dans le storyboard", async () => {
    const fake = makePorts({ stage: "EDIT", video: { storyboard: makeStoryboard() } });
    const result = await regeneratePlan(fake.ports, { videoId: VIDEO_ID, planId: "P02", prompt: "  a brass paperclip, vertical 9:16 composition  " });
    expect(result).toEqual({ ok: true, message: "P02 régénéré (tentative 1)." });
    expect(fake.image.requests[0]?.prompt).toBe("a brass paperclip, vertical 9:16 composition");
    expect(fake.calls.saved[0]?.plans.find((plan) => plan.id === "P02")?.prompt_en).toBe("a brass paperclip, vertical 9:16 composition");

    const again = await regeneratePlan(fake.ports, { videoId: VIDEO_ID, planId: "P02", prompt: "a brass paperclip, vertical 9:16 composition" });
    expect(again.message).toContain("tentative 2");
    expect(fake.media.records.map((record) => record.attempt)).toEqual([1, 2]);
  });

  it.each([
    ["vidéo au rendu", { stage: "RENDER" as const, video: { storyboard: makeStoryboard() } }, "P02", /avant le rendu/],
    ["plan inconnu", { video: { storyboard: makeStoryboard() } }, "P42", /introuvable/],
    ["plan non généré", { video: { storyboard: makeStoryboard() } }, "P03", /pas un plan généré/],
    ["sans générateur", { tools: "none" as const, video: { storyboard: makeStoryboard() } }, "P02", /aucun générateur/],
    ["budget épuisé", { video: { storyboard: makeStoryboard(), totalCost: 5 } }, "P02", /il reste 0,00 €/],
  ])("%s : refusée sans génération", async (_label, options, planId, message) => {
    const fake = makePorts(options);
    const result = await regeneratePlan(fake.ports, { videoId: VIDEO_ID, planId, prompt: "a paperclip on a desk" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(message);
    expect(fake.media.records).toEqual([]);
  });

  it("vidéo bloquée à l'étape des visuels : régénération possible", async () => {
    const fake = makePorts({ stage: "NEEDS_FIX", video: { blockedAt: "VISUALS_AND_AUDIO", storyboard: makeStoryboard() } });
    expect((await regeneratePlan(fake.ports, { videoId: VIDEO_ID, planId: "P01", prompt: "a paperclip on a desk" })).ok).toBe(true);
    expect(fake.videoGen.requests).toHaveLength(1);
  });
});
