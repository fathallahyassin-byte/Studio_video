import { describe, expect, it } from "vitest";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { PAYLOAD } from "./fixtures";
import { parseStrategyForm, readStrategyPayload } from "./payload";
import { buildStrategyVariables, formatContraintes, formatPistes, NO_PISTES, NO_REFUS } from "./variables";

describe("payload du worker", () => {
  it("accepte le formulaire validé", () => {
    expect(readStrategyPayload(PAYLOAD)).toEqual(PAYLOAD);
  });

  it.each([
    ["absent", null],
    ["sans objectif", { ...PAYLOAD, objectifRevenus: "  " }],
    ["heures négatives", { ...PAYLOAD, heuresParSemaine: -2 }],
    ["pistes en texte", { ...PAYLOAD, pistes: "a\nb" }],
  ])("refuse un payload %s avec une AgentPreconditionError", (_label, payload) => {
    expect(() => readStrategyPayload(payload)).toThrow(AgentPreconditionError);
  });

  it("nomme les champs fautifs", () => {
    expect(() => readStrategyPayload({ ...PAYLOAD, budgetMensuel: "beaucoup" })).toThrow(/budgetMensuel/);
  });
});

describe("formulaire de la page", () => {
  const form = { pistes: " histoire des objets \n\n inventions ratées\r\n", heuresParSemaine: "6", budgetMensuel: "80,5", objectifRevenus: " 500 € par mois ", refus: "" };

  it("découpe les lignes, accepte la virgule décimale et retire les espaces", () => {
    expect(parseStrategyForm(form)).toEqual({
      ok: true,
      payload: { pistes: ["histoire des objets", "inventions ratées"], heuresParSemaine: 6, budgetMensuel: 80.5, objectifRevenus: "500 € par mois", refus: [] },
    });
  });

  it("explique chaque champ invalide", () => {
    const result = parseStrategyForm({ ...form, heuresParSemaine: "", objectifRevenus: "" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/Heures par semaine.*Objectif de revenus/);
  });

  it("refuse un champ absent ou non textuel", () => {
    expect(parseStrategyForm({ ...form, budgetMensuel: undefined }).ok).toBe(false);
  });
});

describe("variables du prompt", () => {
  it("dit explicitement qu'aucune piste n'est fournie", () => {
    expect(formatPistes([])).toBe(NO_PISTES);
    expect(formatPistes(["a", "b"])).toBe("2 piste(s) :\n- a\n- b");
  });

  it("résume temps, budget, langue et refus", () => {
    const text = formatContraintes({ ...PAYLOAD, heuresParSemaine: 7.5, budgetMensuel: 1200 });
    expect(text).toContain("7,5 h par semaine");
    expect(text).toMatch(/1\s200 €/);
    expect(text).toContain("français");
    expect(text).toContain("montrer mon visage ; parler de politique");
    expect(formatContraintes({ ...PAYLOAD, refus: [] })).toContain(NO_REFUS);
  });

  it("remplit les 4 variables du prompt", () => {
    expect(buildStrategyVariables(PAYLOAD, "modèle")).toEqual({
      PISTES_NICHES: expect.stringContaining("histoire des objets"),
      CONTRAINTES: expect.stringContaining("6 h par semaine"),
      OBJECTIF_MONETISATION: "500 € par mois dans 12 mois",
      MODELE_BIBLE: "modèle",
    });
  });
});
