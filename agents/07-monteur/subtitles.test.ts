import { describe, expect, it } from "vitest";
import { makeWords } from "./fixtures";
import { FPS, frameOf } from "./frames";
import { activeWord, buildSubtitles, cleanWords, groupWords, HOLD_S, lastWordEnd, lineCount, MAX_WORDS_PER_GROUP } from "./subtitles";

const w = (word: string, startS: number, endS: number) => ({ word, startS, endS });
const texts = (groups: { text: string }[][]) => groups.map((group) => group.map((word) => word.text).join(" "));

describe("nettoyage de l'horodatage", () => {
  it("rattache la ponctuation isolée au mot précédent (espace insécable avant ? ! : ;)", () => {
    const words = cleanWords([w("Vraiment", 0, 0.4), w("?", 0.4, 0.45), w("Oui", 1, 1.3), w(",", 1.3, 1.31), w("bien", 1.4, 1.6), w(".", 1.6, 1.62)]);
    expect(words.map((word) => word.text)).toEqual(["Vraiment ?", "Oui,", "bien."]);
    expect(words[0]).toMatchObject({ startS: 0, endS: 0.45 });
  });

  it("fusionne les élisions découpées par Whisper (« l' » + « eau »)", () => {
    const words = cleanWords([w("l'", 0, 0.1), w("eau", 0.12, 0.4), w("d’", 0.5, 0.55), w("abord", 0.56, 0.9)]);
    expect(words.map((word) => word.text)).toEqual(["l'eau", "d’abord"]);
    expect(words[0]).toMatchObject({ startS: 0, endS: 0.4 });
  });

  it("mots collés : deux mots qui démarrent dans la même image n'en font qu'un, un chevauchement est coupé", () => {
    const words = cleanWords([w("pomme", 1, 1.3), w("de", 1.01, 1.2), w("terre", 1.25, 1.6), w("cuite", 1.5, 1.9)]);
    expect(words.map((word) => word.text)).toEqual(["pomme de", "terre", "cuite"]);
    expect(words[0]?.endS).toBe(1.25);
    expect(words[1]?.endS).toBe(1.5);
    for (let index = 1; index < words.length; index += 1) {
      expect(frameOf(words[index]?.startS ?? 0)).toBeGreaterThan(frameOf(words[index - 1]?.startS ?? 0));
    }
  });

  it("retire les mots vides ou aux temps invalides, ramène les temps négatifs à 0 et trie", () => {
    const words = cleanWords([w("deux", 0.5, 0.8), w("  ", 0.2, 0.3), w("un", -0.1, 0.3), w("nan", Number.NaN, 1), w("fin", 1, 0.9)]);
    expect(words).toEqual([
      { text: "un", startS: 0, endS: 0.3 },
      { text: "deux", startS: 0.5, endS: 0.8 },
      { text: "fin", startS: 1, endS: 1 },
    ]);
  });

  it("guillemets ouvrants rattachés au mot suivant", () => {
    const words = cleanWords([w("«", 0, 0.05), w("Eurêka", 0.05, 0.5), w("»", 0.5, 0.52)]);
    expect(words.map((word) => word.text)).toEqual(["« Eurêka »"]);
  });

  it("lastWordEnd : fin du dernier mot prononcé", () => {
    expect(lastWordEnd(cleanWords(makeWords()))).toBe(11.95);
    expect(lastWordEnd([])).toBe(0);
  });
});

describe("groupes de sous-titres", () => {
  it("1 à 4 mots, coupure après la ponctuation de fin de proposition", () => {
    const groups = groupWords(cleanWords(makeWords()));
    expect(texts(groups)).toEqual([
      "Ton trombone cache un",
      "secret.",
      "Personne ne sait vraiment",
      "qui l'a inventé,",
      "pas même les historiens.",
      "Pourtant la réponse tient",
      "en une seule date.",
    ]);
    expect(groups.every((group) => group.length >= 1 && group.length <= MAX_WORDS_PER_GROUP)).toBe(true);
  });

  it("une pause de 0,4 s ou plus commence un nouveau groupe", () => {
    const groups = groupWords(cleanWords([w("Attends", 0, 0.4), w("un", 0.45, 0.6), w("peu", 1.1, 1.4)]));
    expect(texts(groups)).toEqual(["Attends un", "peu"]);
  });

  it("2 lignes au plus : un groupe trop long est coupé avant 4 mots", () => {
    const groups = groupWords(cleanWords(makeWords("anticonstitutionnellement extraordinairement incompréhensible voilà")));
    expect(texts(groups)).toEqual(["anticonstitutionnellement extraordinairement", "incompréhensible voilà"]);
    expect(groups.every((group) => lineCount(group.map((word) => word.text)) <= 2)).toBe(true);
  });

  it("lineCount : retour à la ligne entre les mots", () => {
    expect(lineCount([])).toBe(0);
    expect(lineCount(["Ton", "trombone"])).toBe(1);
    expect(lineCount(["Ton", "trombone", "cache", "un"])).toBe(2);
    expect(lineCount(["anticonstitutionnellement", "oui"])).toBe(2);
  });
});

describe("piste sous_titres", () => {
  const words = cleanWords(makeWords());
  const cues = buildSubtitles(words, 12.2);

  it("une entrée par mot : le groupe reste affiché, le mot actif change", () => {
    expect(cues).toHaveLength(24);
    expect(cues.slice(0, 4).map((cue) => cue.mots)).toEqual(Array(4).fill("Ton trombone cache un"));
    expect(cues.slice(0, 4).map((cue) => cue.mot_actif)).toEqual(["Ton", "trombone", "cache", "un"]);
    expect(cues[4]).toMatchObject({ mots: "secret.", mot_actif: "secret" });
  });

  it("dans un groupe, chaque mot reste actif jusqu'au mot suivant (pas de clignotement)", () => {
    expect(cues[0]).toMatchObject({ debut_s: 0, fin_s: 0.5 });
    expect(cues[1]).toMatchObject({ debut_s: 0.5, fin_s: 1 });
  });

  it("fin de groupe : dernier mot + 0,3 s, jamais au-delà du groupe suivant", () => {
    // « un » finit à 1,95 s, « secret. » démarre à 2 s.
    expect(cues[3]?.fin_s).toBe(2);
    const paused = buildSubtitles(cleanWords([w("Stop.", 0, 0.4), w("Repars", 2, 2.4)]), 3);
    expect(paused[0]).toMatchObject({ debut_s: 0, fin_s: 0.4 + HOLD_S });
  });

  it("dernier mot : tenu 0,3 s au plus, coupé à la fin de la vidéo", () => {
    expect(cues.at(-1)).toMatchObject({ mot_actif: "date", debut_s: 11.5, fin_s: 12.2 });
    expect(buildSubtitles(words, 12).at(-1)?.fin_s).toBe(12);
  });

  it("temps calés sur l'image, ordonnés, sans chevauchement ni durée nulle", () => {
    for (const [index, cue] of cues.entries()) {
      expect(Math.abs(cue.debut_s * FPS - Math.round(cue.debut_s * FPS))).toBeLessThan(0.05);
      expect(cue.fin_s).toBeGreaterThan(cue.debut_s);
      const next = cues[index + 1];
      if (next) expect(next.debut_s).toBeGreaterThanOrEqual(cue.fin_s);
    }
  });

  it("déterministe : même horodatage, mêmes sous-titres", () => {
    expect(buildSubtitles(cleanWords(makeWords()), 12.2)).toEqual(cues);
  });

  it("un mot très court garde au moins une image", () => {
    const [cue] = buildSubtitles(cleanWords([w("Hop", 1, 1)]), 2);
    expect(cue).toMatchObject({ debut_s: 1, fin_s: 1.3 });
    const [tight] = buildSubtitles(cleanWords([w("Hop", 1, 1)]), 1.01);
    expect(tight?.fin_s).toBeGreaterThan(tight?.debut_s ?? 0);
  });

  it("activeWord retire la ponctuation autour du mot", () => {
    expect(activeWord("« Eurêka !")).toBe("Eurêka");
    expect(activeWord("l'a")).toBe("l'a");
    expect(activeWord("…")).toBe("…");
  });
});
