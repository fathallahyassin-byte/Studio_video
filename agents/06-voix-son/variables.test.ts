import { describe, expect, it } from "vitest";
import { makeStoryboard } from "@/agents/05-directeur-artistique/fixtures";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { BIBLE_WITHOUT_VOICE, makeOutput, makeScript, makeTts, TEST_BIBLE } from "./fixtures";
import {
  CORRECTION_HEADING,
  formatScriptVariable,
  formatStoryboardVariable,
  formatTts,
  formatTtsTags,
  NO_STORYBOARD,
  NO_TTS,
  NO_TTS_TAGS,
  parseAudioSettings,
  readAudioSettings,
  readScript,
  readStoryboard,
  readVoiceId,
  scriptWords,
} from "./variables";

describe("{{SCRIPT}}", () => {
  it("sans note : le script seul", () => {
    expect(JSON.parse(formatScriptVariable(makeScript(), null, makeOutput()))).toMatchObject({ idee_id: "I-07" });
  });

  it("avec une note : intitulé explicite, puis le plan précédent s'il existe", () => {
    const text = formatScriptVariable(makeScript(), "  Moins grave.  ", makeOutput({ texte_tts: "Ancien texte." }));
    expect(text).toContain(`${CORRECTION_HEADING} :\nMoins grave.`);
    expect(text).toContain("Ancien texte.");
    expect(formatScriptVariable(makeScript(), "Moins grave.", null)).not.toContain("Plan sonore précédent");
  });

  it("refuse un script absent ou illisible", () => {
    expect(() => readScript(null)).toThrow(AgentPreconditionError);
    expect(() => readScript({ idee_id: "I-07" })).toThrow(/illisible/);
    expect(scriptWords(makeScript())).toBe(46);
  });
});

describe("{{STORYBOARD}}", () => {
  it("les plans s'ils existent", () => {
    const text = formatStoryboardVariable(readStoryboard(makeStoryboard()), makeScript());
    expect(text).not.toContain(NO_STORYBOARD);
    expect(JSON.parse(text)).toHaveLength(8);
  });

  it("sinon : le dit explicitement et donne les beats (B1, B2…)", () => {
    const text = formatStoryboardVariable(readStoryboard(null), makeScript());
    expect(text.startsWith(NO_STORYBOARD)).toBe(true);
    expect(text).toContain('"plan": "B5"');
    expect(readStoryboard({ plans: "illisible" })).toBeNull();
  });
});

describe("{{TTS}} et {{BALISES_TTS}}", () => {
  it("le moteur branché et ses balises", () => {
    const tts = makeTts();
    expect(formatTts(tts)).toBe("faux-tts");
    expect(formatTtsTags(tts)).toBe('<break time="0.5s"/>');
  });

  it("sans moteur : une phrase explicite, pas d'invention", () => {
    expect(formatTts(null)).toBe(NO_TTS);
    expect(formatTtsTags(null)).toBe(NO_TTS_TAGS);
    expect(formatTtsTags({ supportedTags: [] })).toBe(NO_TTS_TAGS);
  });
});

describe("réglages tirés de la bible", () => {
  it("durée cible, débit, loudness, voix et langue", () => {
    expect(parseAudioSettings(TEST_BIBLE)).toEqual({
      ok: true,
      settings: { target: { minS: 20, maxS: 30, wordsPerSecond: 2 }, loudnessLufs: -14, voiceId: "voix-claire", language: "fr-FR" },
    });
  });

  it("voix non renseignée : null", () => {
    expect(parseAudioSettings(BIBLE_WITHOUT_VOICE)).toMatchObject({ ok: true, settings: { voiceId: null } });
    expect(readVoiceId("id-seul")).toBe("id-seul");
    expect(readVoiceId("moteur / ")).toBeNull();
  });

  it("sans bible : précondition", () => {
    expect(() => readAudioSettings(null)).toThrow(AgentPreconditionError);
    expect(() => readAudioSettings("pas: [une bible")).toThrow(/Bible inutilisable/);
  });
});
