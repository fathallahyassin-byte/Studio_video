import { describe, expect, it } from "vitest";
import { parseStoredAudioPlan, type AudioPlan } from "./audioPlan";
import { recordAudioPlan } from "./definition";
import { makeOutput, makePorts, makeTts, MANUAL_TRACK, TEST_BIBLE, type PortOptions } from "./fixtures";
import { canEditAt, chooseMusic, regenerateVoice } from "./regenerate";

const VIDEO_ID = "video-1";

/** Vidéo dont le plan sonore est déjà enregistré (voix et musique réglées), au montage. */
async function withSavedPlan(options: PortOptions = {}) {
  const fake = makePorts(options);
  await recordAudioPlan(fake.ports, VIDEO_ID, makeOutput(), { bible: TEST_BIBLE });
  return fake;
}

const NEW_TEXT = makeOutput().texte_tts.replace("Ton trombone", "Ton petit trombone");

describe("étapes où l'humain peut modifier le son", () => {
  it("avant le rendu seulement", () => {
    expect(canEditAt({ stage: "VISUALS_AND_AUDIO", blockedAt: null })).toBe(true);
    expect(canEditAt({ stage: "EDIT", blockedAt: null })).toBe(true);
    expect(canEditAt({ stage: "NEEDS_FIX", blockedAt: "VISUALS_AND_AUDIO" })).toBe(true);
    expect(canEditAt({ stage: "NEEDS_FIX", blockedAt: "QA" })).toBe(false);
    expect(canEditAt({ stage: "RENDER", blockedAt: null })).toBe(false);
  });
});

describe("« Régénérer la voix »", () => {
  it("nouvelle tentative avec le texte modifié : nouvel Asset voix, plan mis à jour", async () => {
    const fake = await withSavedPlan();
    const result = await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT });
    expect(result).toEqual({ ok: true, message: "Voix régénérée (tentative 2) : 25 s. Le montage est relancé avec ce son." });
    expect(fake.calls.soundChanged).toBe(1);
    expect(fake.voices.records).toHaveLength(2);
    const plan = parseStoredAudioPlan(fake.video.audio);
    expect(plan?.texte_tts).toBe(NEW_TEXT);
    expect(plan?.production.voix).toMatchObject({ tentative: 2, url: "https://voix.test/voix-2.mp3", duree_s: 25 });
    expect(plan?.production.duree_estimee_s).toBe(25);
  });

  it("le même texte régénéré deux fois fait deux tentatives distinctes", async () => {
    const fake = await withSavedPlan();
    await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT });
    await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT });
    expect(fake.voices.records.map((record) => record.attempt)).toEqual([1, 2, 3]);
  });

  it("signale une durée hors cible", async () => {
    const fake = await withSavedPlan({ tts: makeTts({ durationOf: (text) => (text.includes("petit") ? 33 : 24.5) }) });
    const result = await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT });
    expect(result.message).toContain("hors de la cible de 20 à 30 s");
  });

  it.each([
    ["sans TTS", { tts: null }, /Aucun moteur/],
    ["sans budget", { perVideo: "0.1" }, /il reste/],
  ] as const)("refusée %s", async (_label, options, message) => {
    const fake = makePorts(options);
    const plan: AudioPlan | null = parseStoredAudioPlan((await withSavedPlan()).video.audio);
    fake.video.audio = plan;
    fake.video.stage = "EDIT";
    const result = await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(message) });
  });

  it("refusée avec des chiffres dans le texte, ou sans plan enregistré, ou après le rendu", async () => {
    const fake = await withSavedPlan();
    expect((await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: "Né en 1899." })).message).toContain("1899");
    expect((await regenerateVoice(makePorts().ports, { videoId: VIDEO_ID, text: NEW_TEXT })).message).toContain("pas encore enregistré");
    fake.video.stage = "RENDER";
    expect((await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT })).ok).toBe(false);
  });
});

describe("piste choisie par l'humain", () => {
  it("licence obligatoire : sans elle, rien n'est enregistré", async () => {
    const fake = makePorts();
    const result = await chooseMusic(fake.ports, { videoId: VIDEO_ID, title: "Piste", url: "https://musique.test/p.mp3", license: "  " });
    expect(result.ok).toBe(false);
    expect(fake.music.tracks).toEqual([]);
  });

  it("sans plan enregistré : la piste est gardée pour la relance de l'étape", async () => {
    const fake = makePorts({ stage: "NEEDS_FIX", video: { blockedAt: "VISUALS_AND_AUDIO" } });
    const result = await chooseMusic(fake.ports, { videoId: VIDEO_ID, title: MANUAL_TRACK.titre, url: MANUAL_TRACK.url, license: MANUAL_TRACK.licence });
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Relance l'étape") });
    expect(fake.music.manual).toEqual(MANUAL_TRACK);
    expect(fake.calls.saved).toEqual([]);
  });

  it("avec un plan enregistré : la piste le remplace", async () => {
    const fake = await withSavedPlan();
    await chooseMusic(fake.ports, { videoId: VIDEO_ID, title: MANUAL_TRACK.titre, url: MANUAL_TRACK.url, license: MANUAL_TRACK.licence });
    expect(parseStoredAudioPlan(fake.video.audio)?.production.musique).toEqual(MANUAL_TRACK);
  });
});

describe("son modifié au montage", () => {
  it("bloquée au montage : la timeline est effacée, la relance de l'étape refera le montage", async () => {
    const fake = await withSavedPlan();
    fake.video.stage = "NEEDS_FIX";
    fake.video.blockedAt = "EDIT";
    const result = await chooseMusic(fake.ports, { videoId: VIDEO_ID, title: MANUAL_TRACK.titre, url: MANUAL_TRACK.url, license: MANUAL_TRACK.licence });
    expect(result.message).toContain("La timeline est effacée : relance l'étape");
  });

  it("aux visuels et son : rien à refaire", async () => {
    const fake = await withSavedPlan();
    fake.video.stage = "VISUALS_AND_AUDIO";
    const result = await regenerateVoice(fake.ports, { videoId: VIDEO_ID, text: NEW_TEXT });
    expect(result).toMatchObject({ ok: true, message: "Voix régénérée (tentative 2) : 25 s." });
  });
});
