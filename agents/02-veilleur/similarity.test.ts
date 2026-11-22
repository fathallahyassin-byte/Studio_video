import { describe, expect, it } from "vitest";
import { findSimilarTitle, normalizeText, titleSimilarity, titleWords } from "./similarity";

describe("similarité des titres", () => {
  it("normalise accents, majuscules et ponctuation", () => {
    expect(normalizeText("L'Été, à Évian !")).toBe("l ete a evian");
  });

  it("ignore les mots vides et les pluriels simples", () => {
    expect([...titleWords("Pourquoi les crayons sont jaunes")]).toEqual(["crayon", "jaune"]);
  });

  it("vaut 1 pour deux formulations des mêmes mots et 0 sans mot commun", () => {
    expect(titleSimilarity("Pourquoi les crayons sont jaunes", "Les crayons : pourquoi jaune ?")).toBe(1);
    expect(titleSimilarity("Le secret du trombone", "Pourquoi le savon mousse")).toBe(0);
    expect(titleSimilarity("", "Le trombone")).toBe(0);
  });

  it("trouve un titre existant trop proche", () => {
    const existing = ["Pourquoi le savon mousse", "Pourquoi les crayons sont jaunes"];
    expect(findSimilarTitle("Pourquoi les crayons à papier sont jaunes", existing)).toBe("Pourquoi les crayons sont jaunes");
  });

  it("ne signale pas une idée qui partage seulement un mot", () => {
    expect(findSimilarTitle("Le secret de la pince à linge", ["Le secret du trombone"])).toBeNull();
  });

  it("garde le titre le plus proche quand plusieurs dépassent le seuil", () => {
    const existing = ["Crayons jaunes et graphite", "Pourquoi les crayons sont jaunes"];
    expect(findSimilarTitle("Pourquoi les crayons sont jaunes", existing)).toBe("Pourquoi les crayons sont jaunes");
  });
});
