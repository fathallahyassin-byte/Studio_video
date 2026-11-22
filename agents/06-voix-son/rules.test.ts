import { describe, expect, it } from "vitest";
import type { ControlResult } from "@/agents/_shared/types";
import { CUTS, makeOutput, makeScript, STORYBOARD_EFFECTS, TEST_BIBLE, TTS_TEXT } from "./fixtures";
import {
  checkAudioPlan,
  checkCuts,
  checkDirections,
  checkEffects,
  checkEmphasis,
  checkMix,
  checkMusic,
  checkPronunciations,
  checkTextLength,
  checkTtsText,
  durationVerdict,
  estimateVoiceS,
  normalizeAudioPlan,
  planCuts,
  removeExcerpt,
  spokenText,
  spokenWords,
  tagName,
  type AudioContext,
} from "./rules";
import { buildAudioContext, parseAudioSettings } from "./variables";

const failures = (results: readonly ControlResult[]) => results.flatMap((result) => (result.ok ? [] : [result.reason]));

function settings() {
  const parsed = parseAudioSettings(TEST_BIBLE);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.settings;
}

function context(overrides: Partial<AudioContext> = {}): AudioContext {
  return { ...buildAudioContext(makeScript(), null, settings(), ["break"]), ...overrides };
}

const storyboardPlans = [
  { id: "P01", debut_s: 0, fin_s: 3 },
  { id: "P03", debut_s: 5.5, fin_s: 8 },
  { id: "P04", debut_s: 8, fin_s: 11 },
  { id: "P06", debut_s: 15, fin_s: 18.5 },
];

describe("sortie d'exemple", () => {
  it("passe tous les contrôles, sans storyboard (beats) comme avec (plans)", () => {
    expect(failures(checkAudioPlan(makeOutput(), context()))).toEqual([]);
    expect(failures(checkAudioPlan(makeOutput({ effets: STORYBOARD_EFFECTS }), context({ plans: storyboardPlans })))).toEqual([]);
  });
});

describe("texte prononcé et durée estimée", () => {
  it("retire les balises et compte les mots prononcés", () => {
    expect(spokenText('Un secret. <break time="0.5s"/> Deux [pause] mots')).toBe("Un secret. Deux mots");
    expect(spokenWords(TTS_TEXT)).toBe(49);
  });

  it("estime la durée au débit de la bible", () => {
    expect(estimateVoiceS(TTS_TEXT, 2)).toBe(24.5);
    expect(estimateVoiceS(TTS_TEXT, 2.6)).toBe(18.8);
  });

  it("lit le nom des balises déclarées ou écrites", () => {
    expect(tagName('<break time="0.5s"/>')).toBe("break");
    expect(tagName("</emphasis>")).toBe("emphasis");
    expect(tagName("[pause]")).toBe("pause");
    expect(tagName("break")).toBe("break");
  });
});

describe("normalize", () => {
  it("fixe le mixage du prompt et de la bible, trie et nettoie", () => {
    const output = makeOutput({
      mixage: { cible_lufs: -9, musique_sous_voix_db: 20, ducking: false },
      effets: [...makeOutput().effets].reverse(),
      prononciations: [
        { mot: " Vaaler ", phonetique: " Va-leur " },
        { mot: "vaaler", phonetique: "autre" },
      ],
      coupes_si_trop_long: [" un Norvégien, ", "", "un norvégien,"],
    });
    const normalized = normalizeAudioPlan(output, { loudnessLufs: -14 });
    expect(normalized.mixage).toEqual({ cible_lufs: -14, musique_sous_voix_db: -20, ducking: true });
    expect(normalized.effets.map((effect) => effect.t_s)).toEqual([0, 3, 8, 15]);
    expect(normalized.prononciations).toEqual([{ mot: "Vaaler", phonetique: "Va-leur" }]);
    expect(normalized.coupes_si_trop_long).toEqual(["un Norvégien,"]);
  });
});

describe("contrôles", () => {
  it("refuse un idee_id différent de celui du script", () => {
    expect(failures(checkAudioPlan(makeOutput({ idee_id: "I-99" }), context()))[0]).toContain("I-07");
  });

  it("exige une direction par beat du script", () => {
    const output = makeOutput({ direction_par_beat: makeOutput().direction_par_beat.slice(0, 4).concat([{ beat: 9, ton: "grave", vitesse: 1, mots_appuyes: [] }]) });
    const result = checkDirections(output, makeScript().beats);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("beats sans direction : 5") });
    expect(result).toMatchObject({ reason: expect.stringContaining("absents du script : 9") });
  });

  it("refuse les chiffres et les balises que le moteur n'accepte pas", () => {
    expect(failures(checkTtsText("Né en 1899.", ["break"]))[0]).toContain("1899");
    expect(failures(checkTtsText('Un <break time="1s"/> deux.', ["break"]))).toEqual([]);
    expect(failures(checkTtsText("Un <emphasis>deux</emphasis>.", ["break"]))[0]).toContain("<emphasis>");
    expect(failures(checkTtsText('Un <break time="1s"/> deux.', null))[0]).toContain("aucun moteur");
  });

  it("refuse un texte TTS qui coupe la voix du script", () => {
    const short = makeOutput({ texte_tts: "Ton trombone cache un secret." });
    expect(checkTextLength(short, 46)).toMatchObject({ ok: false, reason: expect.stringContaining("au moins 39 mots") });
  });

  it("refuse une prononciation sans graphie phonétique", () => {
    expect(checkPronunciations(makeOutput({ prononciations: [{ mot: "Vaaler", phonetique: "" }] })).ok).toBe(false);
  });

  it("refuse un mot à appuyer absent du texte", () => {
    const output = makeOutput({ direction_par_beat: [{ beat: 1, ton: "grave", vitesse: 1, mots_appuyes: ["inconnu"] }] });
    expect(checkEmphasis(output)).toMatchObject({ ok: false, reason: expect.stringContaining("« inconnu » (beat 1)") });
    const accents = makeOutput({ direction_par_beat: [{ beat: 1, ton: "grave", vitesse: 1, mots_appuyes: ["NOTRE"] }] });
    expect(checkEmphasis(accents).ok).toBe(true);
  });

  it("exige 4 à 8 effets calés sur un beat (sans storyboard) ou un plan existant", () => {
    const three = makeOutput().effets.slice(0, 3);
    expect(failures(checkEffects(three, context()))[0]).toContain("3 effets");
    expect(failures(checkEffects([...makeOutput().effets.slice(0, 3), { t_s: 3, effet: "pop", plan: "P02" }], context()))[0]).toContain("B1, B2");
    expect(failures(checkEffects([...makeOutput().effets.slice(0, 3), { t_s: 12, effet: "pop", plan: "B2" }], context()))[0]).toContain("hors de B2");
    expect(failures(checkEffects([...STORYBOARD_EFFECTS.slice(0, 3), { t_s: 15, effet: "impact", plan: "P99" }], context({ plans: storyboardPlans })))[0]).toContain("P99");
    expect(failures(checkEffects([...makeOutput().effets.slice(0, 3), { t_s: 40, effet: "fin", plan: "B5" }], context()))[0]).toContain("après la fin du script");
  });

  it("exige une licence commerciale, des mots-clés et un tempo plausible", () => {
    const musique = { ...makeOutput().musique, licence_requise: "libre de droits", mots_cles_recherche: [], bpm: 400 };
    const reasons = failures(checkMusic(makeOutput({ musique })));
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("usage commercial");
  });

  it("garde la musique de 18 à 22 dB sous la voix", () => {
    expect(checkMix(makeOutput({ mixage: { cible_lufs: -14, musique_sous_voix_db: -10, ducking: true } })).ok).toBe(false);
    expect(checkMix(makeOutput()).ok).toBe(true);
  });
});

describe("coupes proposées", () => {
  const target = { minS: 20, maxS: 30, wordsPerSecond: 2 };

  it("chaque coupe doit recopier un passage exact du texte", () => {
    expect(failures(checkCuts(makeOutput({ coupes_si_trop_long: ["un Danois,"] }), target))[0]).toContain("« un Danois, »");
  });

  it("voix estimée trop longue : coupes obligatoires, et suffisantes", () => {
    const slow = { ...target, wordsPerSecond: 1.4 };
    expect(failures(checkCuts(makeOutput({ coupes_si_trop_long: [] }), slow))[0]).toContain("propose des coupes");
    expect(failures(checkCuts(makeOutput({ coupes_si_trop_long: ["un Norvégien,"] }), slow))[0]).toContain("Même avec toutes les coupes");
    expect(failures(checkCuts(makeOutput(), slow))).toEqual([]);
  });

  it("retire un passage et répare la ponctuation", () => {
    expect(removeExcerpt("On l'attribue à Johan Vaaler, un Norvégien, en mille.", "un Norvégien,")).toBe("On l'attribue à Johan Vaaler, en mille.");
    expect(removeExcerpt("Il était là, vraiment.", "vraiment")).toBe("Il était là.");
  });

  it("applique les coupes dans l'ordre jusqu'à passer sous la cible, au débit mesuré", () => {
    const plan = planCuts(TTS_TEXT, CUTS, { durationS: 34.3, maxS: 30 });
    expect(plan.applied).toEqual(CUTS);
    expect(plan.reached).toBe(true);
    expect(plan.estimatedS).toBe(25.9);
    expect(plan.text).not.toContain("Norvégien");

    const enough = planCuts(TTS_TEXT, CUTS, { durationS: 30.5, maxS: 30 });
    expect(enough.applied).toEqual(["un Norvégien,"]);

    const short = planCuts(TTS_TEXT, CUTS, { durationS: 60, maxS: 30 });
    expect(short.reached).toBe(false);
  });

  it("classe la durée réelle par rapport à la cible", () => {
    expect(durationVerdict(25, { minS: 20, maxS: 30 })).toBe("ok");
    expect(durationVerdict(31, { minS: 20, maxS: 30 })).toBe("too_long");
    expect(durationVerdict(12, { minS: 20, maxS: 30 })).toBe("too_short");
  });
});
