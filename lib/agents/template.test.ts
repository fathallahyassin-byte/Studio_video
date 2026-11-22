import { describe, expect, it } from "vitest";
import { listTemplateVariables, MissingVariablesError, renderTemplate } from "./template";

describe("listTemplateVariables", () => {
  it("liste chaque variable une seule fois, dans l'ordre d'apparition", () => {
    expect(listTemplateVariables("{{BIBLE}} {{IDEE}} {{BIBLE}} {{DUREE_S}}")).toEqual(["BIBLE", "IDEE", "DUREE_S"]);
  });

  it("ignore ce qui n'est pas une variable en majuscules", () => {
    expect(listTemplateVariables('{"a": {"b": 1}} {{minuscule}}')).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("remplace toutes les variables", () => {
    expect(renderTemplate("A={{A}}, B={{B}}, A={{A}}", { A: "1", B: "2" })).toBe("A=1, B=2, A=1");
  });

  it("liste toutes les variables manquantes", () => {
    const render = () => renderTemplate("{{A}} {{B}} {{C}}", { B: "ok" });
    expect(render).toThrow(MissingVariablesError);
    expect(render).toThrow("{{A}}, {{C}}");
  });

  it("accepte une valeur vide", () => {
    expect(renderTemplate("[{{SOURCES}}]", { SOURCES: "" })).toBe("[]");
  });

  it("ne relit pas une valeur injectée qui contient une variable", () => {
    expect(renderTemplate("{{A}}", { A: "{{B}}" })).toBe("{{B}}");
  });
});
