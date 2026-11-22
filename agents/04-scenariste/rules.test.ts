import { describe, expect, it } from "vitest";
import { makeBeats, makeDossier, makeScript, withBeat } from "./fixtures";
import {
  checkFacts,
  checkHooks,
  checkIdeaId,
  checkScreenText,
  checkScript,
  checkSentenceLength,
  checkStructure,
  checkTimeline,
  checkWordCount,
  countScriptWords,
  countWords,
  normalizeScript,
  splitSentences,
  wordBounds,
  type ScriptContext,
  type ScriptTarget,
} from "./rules";
import { indexFacts } from "./variables";

const TARGET: ScriptTarget = { durationS: 25, minDurationS: 20, maxDurationS: 30, wordsPerSecond: 2 };
const FACTS = indexFacts(makeDossier());
const CONTEXT: ScriptContext = { target: TARGET, facts: FACTS, ideaId: "I-07" };

const failures = (results: ReturnType<typeof checkScript>) => results.filter((result) => !result.ok);

describe("comptage des mots", () => {
  it("compte les groupes qui contiennent une lettre ou un chiffre, pas la ponctuation isolée", () => {
    expect(countWords("Alors, qui a inventé ton trombone ?")).toBe(6);
    expect(countWords("En 1899 — l'idée… change")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });

  it("additionne la voix de tous les beats du script d'exemple", () => {
    expect(countScriptWords(makeBeats())).toBe(50);
  });

  it("borne la cible à ± 5 % de durée × débit", () => {
    expect(wordBounds(TARGET)).toEqual({ min: 48, max: 52 });
    expect(wordBounds({ ...TARGET, durationS: 77.5, wordsPerSecond: 2.6 })).toEqual({ min: 192, max: 211 });
  });
});

describe("script valide", () => {
  it("passe tous les contrôles", () => {
    expect(failures(checkScript(makeScript(), CONTEXT))).toEqual([]);
  });
});

describe("normalize", () => {
  it("remplace nb_mots et duree_estimee_s par les valeurs recalculées en code", () => {
    const lying = makeScript({ nb_mots: 999, duree_estimee_s: 3, verifications: { accroche_sans_son: true, faits_tous_sources: true, duree_ok: false } });
    const normalized = normalizeScript(lying, TARGET, FACTS);
    expect(normalized.nb_mots).toBe(50);
    expect(normalized.duree_estimee_s).toBe(25);
    expect(normalized.verifications).toEqual({ accroche_sans_son: true, faits_tous_sources: true, duree_ok: true });
  });

  it("recalcule aussi les vérifications de faits et de durée", () => {
    const script = withBeat(3, { faits: ["F3"] });
    expect(normalizeScript(script, { ...TARGET, durationS: 40 }, FACTS).verifications).toMatchObject({ faits_tous_sources: false, duree_ok: false });
  });
});

describe("contrôle des faits", () => {
  it("refuse un id de fait absent du dossier, en nommant le beat", () => {
    const results = failures(checkFacts(withBeat(3, { faits: ["F1", "F9"] }), FACTS));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, reason: expect.stringContaining("F9 (beat 3)") });
    expect(results[0]).toMatchObject({ reason: expect.stringContaining("F1, F2, F3") });
  });

  it("refuse un fait de confiance « faible »", () => {
    const results = failures(checkFacts(withBeat(4, { faits: ["F3"] }), FACTS));
    expect(results).toEqual([{ ok: false, reason: expect.stringContaining("F3 (beat 4)") }]);
    expect(results[0]).toMatchObject({ reason: expect.stringContaining("faible") });
  });

  it("accepte les faits « eleve » et « moyen », même avec des espaces autour de l'id", () => {
    expect(failures(checkFacts(withBeat(3, { faits: [" F1 ", "F2"] }), FACTS))).toEqual([]);
  });
});

describe("contrôle du nombre de mots", () => {
  const addWords = (count: number) => withBeat(2, { voix: `${makeBeats()[1]?.voix ?? ""} ${"encore ".repeat(count)}`.trim() });

  it("accepte jusqu'à 5 % d'écart", () => {
    expect(checkWordCount(addWords(2), TARGET)).toEqual({ ok: true });
  });

  it("refuse au-delà de 5 % au-dessus, avec le compte et la fourchette", () => {
    const result = checkWordCount(addWords(3), TARGET);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("53 mots") });
    expect(result).toMatchObject({ reason: expect.stringContaining("entre 48 et 52") });
    expect(result).toMatchObject({ reason: expect.stringContaining("retire environ 3 mots") });
  });

  it("refuse un script trop court", () => {
    const result = checkWordCount(withBeat(2, { voix: "Tu en utilises des dizaines." }), TARGET);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("ajoute environ 5 mots") });
  });

  it("recompte la voix au lieu de croire nb_mots", () => {
    expect(checkWordCount(makeScript({ nb_mots: 500 }), TARGET)).toEqual({ ok: true });
  });
});

describe("contrôle de la frise", () => {
  it("refuse un trou entre deux beats", () => {
    expect(checkTimeline(withBeat(3, { debut_s: 9 }), TARGET)).toMatchObject({ ok: false, reason: expect.stringContaining("trou de 1 s avant le beat 3") });
  });

  it("refuse un chevauchement", () => {
    expect(checkTimeline(withBeat(4, { debut_s: 14 }), TARGET)).toMatchObject({ ok: false, reason: expect.stringContaining("le beat 4 chevauche le précédent") });
  });

  it("refuse des beats mal numérotés ou à l'envers", () => {
    const swapped = withBeat(2, { n: 3 }, withBeat(3, { n: 2 }));
    expect(checkTimeline(swapped, TARGET)).toMatchObject({ ok: false, reason: expect.stringContaining("porte le numéro") });
    expect(checkTimeline(withBeat(1, { fin_s: 0 }, withBeat(2, { debut_s: 0 })), TARGET)).toMatchObject({ ok: false, reason: expect.stringContaining("finit") });
  });

  it("refuse une frise qui ne commence pas à 0 s", () => {
    expect(checkTimeline(withBeat(1, { debut_s: 1 }), TARGET)).toMatchObject({ ok: false, reason: expect.stringContaining("trou de 1 s avant le beat 1") });
  });

  it("refuse une frise qui finit hors de la durée cible", () => {
    expect(checkTimeline(withBeat(5, { fin_s: 40 }), TARGET)).toMatchObject({ ok: false, reason: expect.stringContaining("hors de la durée cible") });
  });

  it("tolère les arrondis de moins de 0,05 s", () => {
    expect(checkTimeline(withBeat(3, { debut_s: 8.04 }), TARGET)).toEqual({ ok: true });
  });
});

describe("contrôle de la structure", () => {
  it("exige l'accroche en premier, dans les 3 premières secondes", () => {
    expect(checkStructure(withBeat(1, { role: "contexte" }))).toMatchObject({ ok: false, reason: expect.stringContaining("premier beat") });
    expect(checkStructure(withBeat(1, { fin_s: 5 }))).toMatchObject({ ok: false, reason: expect.stringContaining("3 s au plus") });
  });

  it("exige la boucle à la fin et une chute", () => {
    expect(checkStructure(withBeat(5, { role: "chute" }))).toMatchObject({ ok: false, reason: expect.stringContaining("boucle") });
    expect(checkStructure(withBeat(4, { role: "revelation" }))).toMatchObject({ ok: false, reason: expect.stringContaining("il manque la chute") });
  });

  it("refuse un ordre de rôles désordonné et plus de 3 révélations", () => {
    expect(checkStructure(withBeat(2, { role: "revelation" }, withBeat(3, { role: "contexte" })))).toMatchObject({ ok: false, reason: expect.stringContaining("ordre attendu") });
    const [hook, , revelation, chute, loop] = makeBeats();
    if (!hook || !revelation || !chute || !loop) throw new Error("fixture incomplète");
    const extra = [2, 3, 4, 5].map((n) => ({ ...revelation, n }));
    const many = makeScript({ beats: [hook, ...extra, { ...chute, n: 6 }, { ...loop, n: 7 }] });
    expect(checkStructure(many)).toMatchObject({ ok: false, reason: expect.stringContaining("4 révélations") });
  });
});

describe("règles d'écriture", () => {
  it("découpe les phrases sur . ! ? et …", () => {
    expect(splitSentences("Un. Deux trois ! Quatre… Cinq ? 3.5 reste")).toEqual(["Un.", "Deux trois !", "Quatre…", "Cinq ?", "3.5 reste"]);
  });

  it("refuse une phrase de plus de 12 mots", () => {
    const long = "Un deux trois quatre cinq six sept huit neuf dix onze douze treize.";
    expect(checkSentenceLength(withBeat(2, { voix: long }))).toMatchObject({ ok: false, reason: expect.stringContaining("beat 2 (13 mots") });
  });

  it("refuse un texte écran hors de 3 à 6 mots", () => {
    expect(checkScreenText(withBeat(5, { texte_ecran: "Qui ?" }))).toMatchObject({ ok: false, reason: expect.stringContaining("beat 5 (1 mots)") });
    expect(checkScreenText(withBeat(5, { texte_ecran: "un deux trois quatre cinq six sept" }))).toMatchObject({ ok: false });
  });

  it("refuse deux accroches du même type et les ouvertures interdites", () => {
    const script = makeScript();
    const sameType = { ...script, accroches: script.accroches.map((hook) => ({ ...hook, type: "question" as const })) };
    expect(checkHooks(sameType)).toMatchObject({ ok: false, reason: expect.stringContaining("types différents") });
    const hello = { ...script, accroches: script.accroches.map((hook, index) => (index === 0 ? { ...hook, voix: "Salut ! Ton trombone cache un secret." } : hook)) };
    expect(checkHooks(hello)).toMatchObject({ ok: false, reason: expect.stringContaining("Salut") });
    expect(checkHooks(withBeat(1, { voix: "« Le saviez-vous ? » Le trombone a un secret." }))).toMatchObject({ ok: false });
    expect(checkHooks(withBeat(1, { voix: "Dans cette vidéo, le trombone." }))).toMatchObject({ ok: false });
  });

  it("exige l'id de l'idée fournie", () => {
    expect(checkIdeaId(makeScript({ idee_id: "I-99" }), "I-07")).toMatchObject({ ok: false, reason: expect.stringContaining("I-07") });
    expect(checkIdeaId(makeScript({ idee_id: "I-99" }), null)).toEqual({ ok: true });
  });
});
