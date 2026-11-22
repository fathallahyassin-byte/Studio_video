import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBibleFields, checkBible, splitLines } from "./bible";

const template = readFileSync(path.resolve(import.meta.dirname, "../../docs/bible.template.yaml"), "utf8");

describe("checkBible", () => {
  it("lit les champs du modèle de bible et signale ses variables à remplir", () => {
    const check = checkBible(template);
    if (!check.ok) throw new Error(check.error);
    expect(check.fields).toMatchObject({ niche: "{{NICHE}}", dureeMin: 65, dureeMax: 90, debitVoix: 2.6 });
    expect(check.fields.sujetsInterdits).toContain("politique");
    expect(check.placeholders).toContain("NICHE");
  });

  it("refuse un YAML illisible ou incomplet", () => {
    expect(checkBible("chaine: [")).toMatchObject({ ok: false, error: expect.stringContaining("YAML invalide") });
    expect(checkBible("chaine:\n  nom: x")).toMatchObject({ ok: false, error: expect.stringContaining("Bible incomplète") });
  });
});

describe("applyBibleFields", () => {
  it("réécrit les champs du formulaire et garde les commentaires et les autres clés", () => {
    const check = checkBible(template);
    if (!check.ok) throw new Error(check.error);
    const updated = applyBibleFields(template, {
      ...check.fields,
      niche: "L'histoire cachée des objets du quotidien",
      dureeMin: 60,
      dureeMax: 75,
      debitVoix: 2.8,
      piliers: ["Cuisine", "Bureau"],
    });

    expect(updated).toContain("# public précis + angle");
    expect(updated).toContain("loudness_lufs: -14");
    expect(updated).toMatch(/duree_cible_s: \[ 60, 75 \] *# plus d'1 min/);
    const reread = checkBible(updated);
    expect(updated).toContain("debit_voix_mots_par_s: 2.8");
    expect(reread).toMatchObject({ ok: true, fields: { niche: "L'histoire cachée des objets du quotidien", debitVoix: 2.8, piliers: ["Cuisine", "Bureau"] } });
  });
});

describe("splitLines", () => {
  it("garde une entrée par ligne non vide", () => {
    expect(splitLines(" Cuisine \r\n\r\nBureau\n")).toEqual(["Cuisine", "Bureau"]);
  });
});
