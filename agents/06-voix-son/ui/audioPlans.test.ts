import { describe, expect, it } from "vitest";
import { recordAudioPlan } from "../definition";
import { makeOutput, makePorts, MANUAL_TRACK, TEST_BIBLE } from "../fixtures";
import { toAudioView, type AudioRow } from "./audioPlans";
import { NO_TTS_NOTE, providerNotes, regenerationAvailability, voiceAvailability } from "./summary";

const row = (changes: Partial<AudioRow> = {}): AudioRow => ({
  id: "video-1",
  label: "V-001",
  title: "Le vrai inventeur du trombone",
  stage: "VISUALS_AND_AUDIO",
  blockedAt: null,
  blockedReason: null,
  updatedLabel: "22 nov., 10:00",
  audioJson: null,
  latestOutput: null,
  manualTrack: null,
  ...changes,
});

async function savedPlan(): Promise<unknown> {
  const fake = makePorts();
  await recordAudioPlan(fake.ports, "video-1", makeOutput(), { bible: TEST_BIBLE });
  return fake.video.audio;
}

describe("toAudioView", () => {
  it("plan enregistré : voix mesurée, piste et licence, cible", async () => {
    const view = toAudioView(row({ stage: "EDIT", audioJson: await savedPlan() }));
    expect(view).toMatchObject({
      saved: true,
      editable: true,
      targetLabel: "20 à 30 s",
      status: { label: "Montage", tone: "ok", notice: null },
      voice: { url: "https://voix.test/voix-1.mp3", seconds: "24,5 s", inTarget: true, timingLabel: "49 mots horodatés (moteur TTS)" },
      track: { title: "Pizzicato curieux", source: "Banque : fausse-banque" },
      pronunciations: [{ word: "Vaaler", phonetic: "Va-leur" }],
    });
    expect(view?.mix).toBe("-14 LUFS · musique -20 dB sous la voix · baisse pendant la parole");
  });

  it("vidéo bloquée sans plan enregistré : dernière sortie du modèle, avis en jaune, piste choisie à la main", () => {
    const view = toAudioView(
      row({ stage: "NEEDS_FIX", blockedAt: "VISUALS_AND_AUDIO", blockedReason: "Voix et son : aucun moteur", latestOutput: makeOutput(), manualTrack: MANUAL_TRACK }),
    );
    expect(view).toMatchObject({
      saved: false,
      voice: null,
      editable: true,
      status: { label: "À corriger (Visuels et son)", tone: "wait", notice: "Voix et son : aucun moteur" },
      track: { title: "Ma piste", license: "CC0", source: "Choisie à la main" },
    });
  });

  it("après le rendu : plus modifiable ; sortie illisible : masquée", async () => {
    expect(toAudioView(row({ stage: "QA", audioJson: await savedPlan() }))?.editable).toBe(false);
    expect(toAudioView(row({ latestOutput: { texte_tts: 3 } }))).toBeNull();
  });
});

describe("disponibilité de « Régénérer la voix »", () => {
  it("désactivée avec une note tant qu'aucun TTS n'est branché", () => {
    expect(regenerationAvailability(null)).toEqual({ enabled: false, note: NO_TTS_NOTE });
    expect(voiceAvailability(regenerationAvailability(null), { saved: true, editable: true }).enabled).toBe(false);
  });

  it("avec un TTS : seulement sur un plan enregistré, avant le rendu", () => {
    const global = regenerationAvailability("faux-tts");
    expect(voiceAvailability(global, { saved: true, editable: true })).toEqual({ enabled: true, note: null });
    expect(voiceAvailability(global, { saved: false, editable: true }).enabled).toBe(false);
    expect(voiceAvailability(global, { saved: true, editable: false }).enabled).toBe(false);
  });

  it("l'en-tête dit ce qui n'est pas branché", () => {
    expect(providerNotes({ tts: null, stt: null, music: null })).toHaveLength(2);
    expect(providerNotes({ tts: "faux-tts", stt: "faux-whisper", music: "fausse-banque" })).toEqual(["Voix : faux-tts.", "Horodatage de secours : faux-whisper.", "Musique : fausse-banque."]);
  });
});
