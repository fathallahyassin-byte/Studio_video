import { describe, expect, it } from "vitest";
import { makeDossier, makeFact } from "../fixtures";
import { filterDossiers, groupFactsByConfidence, sourceHref, toDossierView, type DossierRow } from "./dossiers";

function row(overrides: Partial<DossierRow> = {}): DossierRow {
  return { id: "v1", label: "V-001", title: "Le trombone", stage: "SCRIPT", blockedAt: null, updatedLabel: "22 nov., 10:00", dossierJson: makeDossier(), ...overrides };
}

describe("modèle de vue du panneau", () => {
  it("groupe les faits par confiance, du plus sûr au plus fragile, sans groupe vide", () => {
    const groups = groupFactsByConfidence([makeFact({ id: "F1", confiance: "faible" }), makeFact({ id: "F2", confiance: "eleve" })]);
    expect(groups.map((group) => [group.confidence, group.facts.map((fact) => fact.id)])).toEqual([
      ["eleve", ["F2"]],
      ["faible", ["F1"]],
    ]);
  });

  it("ne rend cliquables que les liens http(s)", () => {
    expect(sourceHref(" https://exemple.fr/a ")).toBe("https://exemple.fr/a");
    expect(sourceHref("source à trouver")).toBeNull();
    expect(sourceHref("javascript:alert(1)")).toBeNull();
  });

  it("compte les faits faibles et repère une vidéo bloquée par le recherchiste", () => {
    const view = toDossierView(row({ stage: "NEEDS_FIX", blockedAt: "RESEARCH" }));
    expect(view).toMatchObject({ weakCount: 1, awaitingFix: true, verdict: "ok" });
    expect(toDossierView(row({ stage: "NEEDS_FIX", blockedAt: "SCRIPT" }))?.awaitingFix).toBe(false);
  });

  it("ignore un dossier illisible", () => {
    expect(toDossierView(row({ dossierJson: { verdict: "ok" } }))).toBeNull();
  });

  it("filtre « faits faibles » : seulement les dossiers à compléter", () => {
    const withWeak = toDossierView(row({ id: "a" }));
    const solid = toDossierView(row({ id: "b", dossierJson: makeDossier({ faits: [makeFact()] }) }));
    const views = [withWeak, solid].filter((view) => view !== null);
    expect(filterDossiers(views, false).map((view) => view.videoId)).toEqual(["a", "b"]);
    expect(filterDossiers(views, true).map((view) => view.videoId)).toEqual(["a"]);
  });
});
