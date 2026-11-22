import { describe, expect, it } from "vitest";
import { makeDossier, makeFact } from "./fixtures";
import {
  checkDossier,
  checkFactCount,
  checkIdeaId,
  checkQuoteLength,
  checkReplacementAngle,
  checkUniqueFactIds,
  decideOutcome,
  extractQuotes,
  formatIdeaVariable,
  formatSourcesVariable,
  hasUsableSource,
  NO_RELIABLE_FACT_REASON,
  NO_SOURCES_TEXT,
  normalizeDossier,
  readIdeaId,
} from "./rules";
import { outputSchema } from "./schema";

describe("schéma de sortie", () => {
  it("accepte un dossier complet", () => {
    expect(outputSchema.safeParse(makeDossier()).success).toBe(true);
  });

  it("refuse un verdict inconnu, un dossier sans fait ou un id de fait mal formé", () => {
    expect(outputSchema.safeParse({ ...makeDossier(), verdict: "peut-etre" }).success).toBe(false);
    expect(outputSchema.safeParse(makeDossier({ faits: [] })).success).toBe(false);
    expect(outputSchema.safeParse(makeDossier({ faits: [makeFact({ id: "fait-1" })] })).success).toBe(false);
  });
});

describe("hasUsableSource", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["source à trouver", false],
    ["Source a trouver", false],
    ["(source à trouver)", false],
    ["N/A", false],
    ["javascript:alert(1)", false],
    ["ftp://exemple.fr/fichier", false],
    ["https://www.insee.fr/fr/statistiques", true],
    ["  http://exemple.fr  ", true],
  ])("« %s » → %s", (url, expected) => {
    expect(hasUsableSource(url)).toBe(expected);
  });
});

describe("normalizeDossier", () => {
  it("force la confiance « faible » quand l'URL est vide ou marquée « source à trouver »", () => {
    const dossier = makeDossier({
      faits: [
        makeFact({ id: "F1", url: "", confiance: "eleve" }),
        makeFact({ id: "F2", url: "Source à trouver", confiance: "moyen" }),
        makeFact({ id: "F3", url: "https://exemple.fr", confiance: "eleve" }),
      ],
    });
    expect(normalizeDossier(dossier).faits.map((fact) => fact.confiance)).toEqual(["faible", "faible", "eleve"]);
  });

  it("ne modifie pas le dossier reçu", () => {
    const dossier = makeDossier({ faits: [makeFact({ url: "" })] });
    normalizeDossier(dossier);
    expect(dossier.faits[0]?.confiance).toBe("eleve");
  });
});

describe("contrôles en code", () => {
  it("acceptent un dossier conforme", () => {
    expect(checkDossier(makeDossier(), "I-07").every((result) => result.ok)).toBe(true);
  });

  it("exigent un angle de remplacement quand le verdict est « angle_a_changer »", () => {
    expect(checkReplacementAngle(makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: null })).ok).toBe(false);
    expect(checkReplacementAngle(makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: "  " })).ok).toBe(false);
    expect(checkReplacementAngle(makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: "Raconter le vrai brevet" })).ok).toBe(true);
    expect(checkReplacementAngle(makeDossier({ verdict: "ok", angle_de_remplacement: null })).ok).toBe(true);
  });

  it("demandent 5 à 10 faits, sauf quand l'angle est à changer", () => {
    const facts = (count: number) => Array.from({ length: count }, (_, index) => makeFact({ id: `F${index + 1}` }));
    expect(checkFactCount(makeDossier({ faits: facts(4) })).ok).toBe(false);
    expect(checkFactCount(makeDossier({ faits: facts(5) })).ok).toBe(true);
    expect(checkFactCount(makeDossier({ faits: facts(10) })).ok).toBe(true);
    expect(checkFactCount(makeDossier({ faits: facts(11) })).ok).toBe(false);
    expect(checkFactCount(makeDossier({ faits: facts(2), verdict: "angle_a_changer", angle_de_remplacement: "x" })).ok).toBe(true);
  });

  it("refusent deux faits avec le même id", () => {
    const result = checkUniqueFactIds(makeDossier({ faits: [makeFact({ id: "F1" }), makeFact({ id: "F2" }), makeFact({ id: "F1" })] }));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("F1") });
  });

  it("refusent une citation exacte de 15 mots ou plus", () => {
    const longQuote = "« un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze »";
    const shortQuote = "« un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze »";
    expect(checkQuoteLength(makeDossier({ faits: [makeFact({ fait: `Il a dit ${longQuote}.` })] }))).toEqual({
      ok: false,
      reason: expect.stringContaining("F1 (15 mots)"),
    });
    expect(checkQuoteLength(makeDossier({ faits: [makeFact({ fait: `Il a dit ${shortQuote}.` })] })).ok).toBe(true);
    expect(checkQuoteLength(makeDossier({ detail_accroche: `“${"mot ".repeat(20)}”` })).ok).toBe(false);
  });

  it("vérifient que le dossier porte l'id de l'idée fournie", () => {
    expect(checkIdeaId(makeDossier({ idee_id: "I-08" }), "I-07").ok).toBe(false);
    expect(checkIdeaId(makeDossier({ idee_id: "I-07" }), "I-07").ok).toBe(true);
    expect(checkIdeaId(makeDossier({ idee_id: "n'importe" }), null).ok).toBe(true);
  });
});

describe("extractQuotes", () => {
  it("trouve les passages entre guillemets français, anglais et droits", () => {
    expect(extractQuotes("« a b » puis “c” et \"d e\" mais pas f")).toEqual(["a b", "c", "d e"]);
  });
});

describe("decideOutcome", () => {
  it("passe au script quand le verdict est ok et qu'un fait est « eleve » ou « moyen »", () => {
    expect(decideOutcome(makeDossier())).toEqual({ kind: "advance" });
    expect(decideOutcome(makeDossier({ verdict: "ok_avec_reserves", faits: [makeFact({ confiance: "moyen" })] }))).toEqual({ kind: "advance" });
  });

  it("bloque quand aucun fait n'est assez fiable, même avec un verdict ok", () => {
    const weakOnly = makeDossier({ faits: [makeFact({ id: "F1", confiance: "faible" }), makeFact({ id: "F2", confiance: "faible" })] });
    expect(decideOutcome(weakOnly)).toEqual({ kind: "block", reason: NO_RELIABLE_FACT_REASON });
  });

  it("bloque avec l'angle de remplacement quand l'angle est à changer", () => {
    const outcome = decideOutcome(makeDossier({ verdict: "angle_a_changer", angle_de_remplacement: "Raconter le vrai brevet de 1899" }));
    expect(outcome).toEqual({ kind: "block", reason: expect.stringContaining("Raconter le vrai brevet de 1899") });
  });
});

describe("variables du prompt", () => {
  it("{{IDEE}} : l'idée en JSON, plus la note de l'humain si elle existe", () => {
    const idea = { id: "I-07", angle: "Le trombone" };
    expect(JSON.parse(formatIdeaVariable(idea, null))).toEqual(idea);
    expect(formatIdeaVariable(idea, "   ")).toBe(JSON.stringify(idea, null, 2));
    expect(formatIdeaVariable(idea, "Insiste sur l'histoire")).toMatch(/Note de l'humain, à prendre en compte : Insiste sur l'histoire$/);
  });

  it("{{SOURCES}} : un lien par ligne, ou « aucune source fournie »", () => {
    expect(formatSourcesVariable([])).toBe(NO_SOURCES_TEXT);
    expect(formatSourcesVariable(["  ", ""])).toBe(NO_SOURCES_TEXT);
    expect(formatSourcesVariable(["https://a.fr", " https://b.fr "])).toBe("- https://a.fr\n- https://b.fr");
  });

  it("lit l'id de l'idée quand il existe", () => {
    expect(readIdeaId({ id: "I-07", angle: "x" })).toBe("I-07");
    expect(readIdeaId({ angle: "x" })).toBeNull();
    expect(readIdeaId(null)).toBeNull();
  });
});
