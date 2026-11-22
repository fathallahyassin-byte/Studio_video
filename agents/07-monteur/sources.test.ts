import { describe, expect, it } from "vitest";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { makeAssets, makeAudioJson, makeAudioPlan, makeContext, makeVideo, MEDIA_URLS, MUSIC_URL, VOICE_URL } from "./fixtures";
import type { EditAsset } from "./ports";
import { blockingIssues, inspectSources, missingMedia, NO_TIMINGS, NO_VOICE, planMedia, readAudioDeliverable, requireEditContext } from "./sources";

const voiceAsset: EditAsset = { type: "VOICE", url: "https://media.test/voix-asset.mp3", planId: null, durationS: 11.8, license: null };
const musicAsset: EditAsset = { type: "MUSIC", url: "https://media.test/musique-asset.mp3", planId: null, durationS: null, license: "Banque Y" };

describe("livrable audio de l'agent 6", () => {
  it("lit la voix, sa durée mesurée, l'horodatage et la musique du bloc production", () => {
    const deliverable = readAudioDeliverable(makeAudioJson(), [voiceAsset, musicAsset]);
    expect(deliverable.voice).toMatchObject({ url: VOICE_URL, measuredS: 12.1 });
    expect(deliverable.voice?.words).toHaveLength(24);
    expect(deliverable.music).toEqual({ url: MUSIC_URL, license: "Banque X, usage commercial 3 plateformes" });
  });

  it("plan sonore de main (sans bloc production) : Asset VOICE et MUSIC en secours, sans horodatage", () => {
    const deliverable = readAudioDeliverable(makeAudioPlan(), [musicAsset, voiceAsset]);
    expect(deliverable).toEqual({ voice: { url: voiceAsset.url, measuredS: 11.8, words: null }, music: { url: musicAsset.url, license: "Banque Y" } });
  });

  it("une musique sans licence n'est jamais utilisée", () => {
    expect(readAudioDeliverable(makeAudioPlan(), [{ ...musicAsset, license: "  " }]).music).toBeNull();
    const json = { ...makeAudioPlan(), production: { musique: { url: MUSIC_URL, licence: "" } } };
    expect(readAudioDeliverable(json, []).music).toBeNull();
  });

  it("rien d'enregistré : ni voix ni musique", () => {
    expect(readAudioDeliverable(makeAudioPlan(), [])).toEqual({ voice: null, music: null });
    expect(readAudioDeliverable(null, [])).toEqual({ voice: null, music: null });
  });
});

describe("préconditions", () => {
  it("storyboard et plan sonore absents ou illisibles", () => {
    const absent = blockingIssues(inspectSources(makeVideo({ storyboard: null, audio: null }), []));
    expect(absent).toEqual([
      "Storyboard absent : l'agent 5 (directeur artistique) ne l'a pas encore enregistré.",
      "Plan sonore absent : l'agent 6 (voix et son) ne l'a pas encore enregistré.",
      NO_VOICE,
    ]);
    const unreadable = blockingIssues(inspectSources(makeVideo({ storyboard: { plans: "?" }, audio: { idee_id: 3 } }), []));
    expect(unreadable.slice(0, 2)).toEqual([
      "Storyboard illisible (schéma de l'agent 5 (directeur artistique) non respecté).",
      "Plan sonore illisible (schéma de l'agent 6 (voix et son) non respecté).",
    ]);
  });

  it("voix sans horodatage : bloquant", () => {
    expect(blockingIssues(inspectSources(makeVideo({ audio: makeAudioJson({ words: null }) }), []))).toEqual([NO_TIMINGS]);
    expect(blockingIssues(inspectSources(makeVideo({ audio: makeAudioJson({ words: [] }) }), []))).toEqual([NO_TIMINGS]);
  });

  it("requireEditContext lève AgentPreconditionError avec la liste", () => {
    expect(() => requireEditContext(inspectSources(makeVideo({ audio: makeAudioPlan() }), []))).toThrow(AgentPreconditionError);
    expect(() => requireEditContext(inspectSources(makeVideo({ audio: makeAudioPlan() }), []))).toThrow(`Montage impossible : ${NO_VOICE}`);
  });

  it("contexte complet : plans triés, horodatage nettoyé, durée mesurée", () => {
    const context = makeContext();
    expect(context.plans.map((plan) => plan.id)).toEqual(["P01", "P02", "P03", "P04"]);
    expect(context.words).toHaveLength(24);
    expect(context.lastWordEndS).toBe(11.95);
    expect(context.voice).toEqual({ url: VOICE_URL, durationS: 12.1, measured: true });
  });
});

describe("médias des plans", () => {
  it("dernier fichier IMAGE ou VIDEO de chaque plan", () => {
    const newer: EditAsset = { type: "IMAGE", url: "https://media.test/p03-v2.png", planId: "P03", durationS: null, license: null };
    expect(planMedia([newer, ...makeAssets(), voiceAsset]).find((media) => media.planId === "P03")?.url).toBe(newer.url);
  });

  it("plans sans fichier : le texte animé n'en demande pas", () => {
    const context = makeContext();
    const media = planMedia(makeAssets()).filter((entry) => entry.url !== MEDIA_URLS.P02);
    expect(missingMedia(context.plans, media).map((plan) => plan.id)).toEqual(["P02"]);
  });
});
