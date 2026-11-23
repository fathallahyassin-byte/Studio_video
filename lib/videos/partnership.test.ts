import { describe, expect, it } from "vitest";
import { normalizePartnership, NO_PARTNERSHIP } from "./partnership";

describe("normalizePartnership", () => {
  it("un champ vide ou « non » devient « aucun »", () => {
    for (const text of ["", "   ", "Aucun", "aucune", "non", "-"]) expect(normalizePartnership(text)).toBe(NO_PARTNERSHIP);
  });

  it("garde la marque et la contrepartie, espaces nettoyés", () => {
    expect(normalizePartnership("  Marque X ,   produit offert ")).toBe("Marque X , produit offert");
  });
});
