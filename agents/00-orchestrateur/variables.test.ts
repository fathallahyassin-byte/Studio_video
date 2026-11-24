import { describe, expect, it } from "vitest";
import { makeProject, NOW } from "./fixtures";
import { BUDGET_MISSING, formatBudgetVariable, formatProjectState, NOTE_HEADING, parseBudget, summarizeDeliverable } from "./variables";

describe("{{BUDGET_PAR_VIDEO}}", () => {
  it("lit un nombre positif, sinon null", () => {
    expect(parseBudget("5")).toBe(5);
    expect(parseBudget(" 7,5 ")).toBe(7.5);
    expect(parseBudget(undefined)).toBeNull();
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("cinq")).toBeNull();
    expect(parseBudget("-2")).toBeNull();
  });

  it("donne le budget, la dépense et le reste", () => {
    expect(formatBudgetVariable(5, 1.234)).toBe("5 par vidéo (déjà dépensé : 1.23 ; reste 3.77)");
  });

  it("budget atteint : le dit en clair", () => {
    expect(formatBudgetVariable(5, 5.4)).toContain("budget ATTEINT");
  });

  it("absent ou invalide : texte explicite plutôt qu'une précondition", () => {
    expect(formatBudgetVariable(null, 3)).toBe(BUDGET_MISSING);
    expect(BUDGET_MISSING).toContain("BUDGET_PAR_VIDEO absent ou invalide");
  });
});

describe("{{ETAT_PROJET}}", () => {
  const read = (text: string): unknown => JSON.parse(text);

  it("contient la vidéo, son étape, ses livrables, ses exécutions, ses validations, son journal et son coût", () => {
    const state = read(formatProjectState(makeProject(), { budget: 5, note: null, now: NOW }));
    expect(state).toMatchObject({
      maintenant: NOW.toISOString(),
      video: { video_id: "video-1", numero: "V-031", etape_actuelle: "SCRIPT", etape_libelle: "Script", cout_total: 0.42, budget_restant: 4.58 },
      dernier_livrable_a_controler: "recherchiste",
      livrables: { idee: expect.stringContaining("I-07"), script: null },
      executions_recentes: [{ agent: "recherchiste", statut: "OK", tentative: 1 }],
      validations: [{ validation: "V1", decision: "APPROVED", par: "humain" }],
      journal_des_etapes: [{ vers: "SCRIPT", par: "recherchiste" }, { vers: "RESEARCH", par: "humain" }],
    });
    expect(state).toMatchObject({ regles_de_cette_etape: expect.stringContaining("humain, scenariste") });
  });

  it("n'envoie jamais l'adresse de l'humain au fournisseur LLM", () => {
    expect(formatProjectState(makeProject(), { budget: 5, note: null, now: NOW })).not.toContain("proprietaire@example.test");
  });

  it("à une validation, rappelle que seul l'humain décide", () => {
    const text = formatProjectState(makeProject({ stage: "AWAITING_V2" }), { budget: 5, note: null, now: NOW });
    expect(read(text)).toMatchObject({ regles_de_cette_etape: expect.stringContaining('agent "humain"') });
  });

  it("ajoute la note de l'humain sous un intitulé", () => {
    const text = formatProjectState(makeProject(), { budget: null, note: "  Garde l'accroche n°2. ", now: NOW });
    expect(text).toContain(`${NOTE_HEADING} :\nGarde l'accroche n°2.`);
    expect(text).toContain('"budget_restant": null');
  });

  it("tronque un livrable trop long et le dit", () => {
    expect(summarizeDeliverable(null)).toBeNull();
    expect(summarizeDeliverable({ a: 1 })).toBe('{"a":1}');
    const long = summarizeDeliverable({ texte: "x".repeat(50) }, 20);
    expect(long).toMatch(/^.{20}… \(tronqué : \d+ caractères au total\)$/);
  });
});
