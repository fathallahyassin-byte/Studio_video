import { describe, expect, it } from "vitest";
import { planPromptSync, type ExistingPromptVersion } from "./promptSync";

const v1: ExistingPromptVersion = { id: "pv1", version: 1, content: "prompt v1\n", source: "FILE" };
const v2ui: ExistingPromptVersion = { id: "pv2", version: 2, content: "prompt retouché\n", source: "UI" };

describe("planPromptSync", () => {
  it("crée la version 1 et l'active au premier seed", () => {
    expect(planPromptSync("prompt v1\n", [], null)).toEqual({ action: "create", version: 1, activate: true });
  });

  it("ne fait rien si le fichier n'a pas changé, même avec des fins de ligne Windows", () => {
    expect(planPromptSync("prompt v1\r\n", [v1], "pv1")).toEqual({ action: "none" });
  });

  it("crée et active une nouvelle version quand le fichier change", () => {
    expect(planPromptSync("prompt v2\n", [v1], "pv1")).toEqual({ action: "create", version: 2, activate: true });
  });

  it("n'écrase pas une version faite depuis l'interface", () => {
    expect(planPromptSync("prompt v3\n", [v1, v2ui], "pv2")).toEqual({ action: "create", version: 3, activate: false });
  });

  it("réactive la version existante si aucune n'est active", () => {
    expect(planPromptSync("prompt v1\n", [v1], null)).toEqual({ action: "activate", versionId: "pv1" });
  });
});
