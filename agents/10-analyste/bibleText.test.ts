import { describe, expect, it } from "vitest";
import { appendLearnings, readLearnings, readNicheCriterion } from "./bibleText";
import { TEST_BIBLE } from "./fixtures";

describe("readNicheCriterion", () => {
  it("lit objectifs.critere_validation_niche", () => {
    expect(readNicheCriterion(TEST_BIBLE)).toBe("10 vidéos à plus de 35 % de visionnage complet");
  });

  it("renvoie null sans bible, sans critère ou avec le champ du modèle", () => {
    expect(readNicheCriterion(null)).toBeNull();
    expect(readNicheCriterion("chaine:\n  nom: x\n")).toBeNull();
    expect(readNicheCriterion('objectifs:\n  critere_validation_niche: "{{CRITERE}}"\n')).toBeNull();
    expect(readNicheCriterion('objectifs:\n  critere_validation_niche: "  "\n')).toBeNull();
    expect(readNicheCriterion("objectifs: [\n")).toBeNull();
  });
});

describe("appendLearnings", () => {
  it("ajoute les lignes préfixées par la période, retire « aucun pour l'instant » et garde les commentaires", () => {
    const result = appendLearnings(TEST_BIBLE, ["Les questions accrochent mieux"], "2026-W48");
    if (!result.ok) throw new Error(result.error);
    expect(result.added).toEqual(["[2026-W48] Les questions accrochent mieux"]);
    expect(readLearnings(result.content)).toEqual(["[2026-W48] Les questions accrochent mieux"]);
    expect(result.content).toContain("# ce que l'analyste a appris");
    expect(result.content).toContain("# BIBLE");
    expect(readNicheCriterion(result.content)).toBe("10 vidéos à plus de 35 % de visionnage complet");
  });

  it("ne touche pas au texte reçu (la version existante reste identique)", () => {
    const original = `${TEST_BIBLE}`;
    appendLearnings(TEST_BIBLE, ["Nouvelle ligne"], "2026-W48");
    expect(TEST_BIBLE).toBe(original);
  });

  it("ignore les lignes vides, les doublons et celles déjà présentes (même avec une autre période)", () => {
    const first = appendLearnings(TEST_BIBLE, ["A", "  A  ", ""], "2026-W47");
    if (!first.ok) throw new Error(first.error);
    const second = appendLearnings(first.content, ["A", "B"], "2026-W48");
    if (!second.ok) throw new Error(second.error);
    expect(second.added).toEqual(["[2026-W48] B"]);
    expect(readLearnings(second.content)).toEqual(["[2026-W47] A", "[2026-W48] B"]);
  });

  it("ne change rien quand tout est déjà présent", () => {
    const first = appendLearnings(TEST_BIBLE, ["A"], "2026-W47");
    if (!first.ok) throw new Error(first.error);
    expect(appendLearnings(first.content, ["A"], "2026-W48")).toEqual({ ok: true, content: first.content, added: [] });
  });

  it("crée la liste si la bible n'en a pas, refuse un YAML invalide", () => {
    const result = appendLearnings("chaine:\n  nom: x\n", ["A"], "2026-W48");
    expect(result.ok && readLearnings(result.content)).toEqual(["[2026-W48] A"]);
    expect(appendLearnings("chaine: [\n", ["A"], "2026-W48").ok).toBe(false);
  });
});
