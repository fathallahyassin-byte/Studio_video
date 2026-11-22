import { describe, expect, it } from "vitest";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { makeScript, makeStoryboard, STYLE_SUFFIX, TEST_BIBLE } from "./fixtures";
import { CORRECTION_HEADING, formatScriptVariable, formatVisualTools, NO_GENERATOR, readStyleSuffix, readVideoAiBudget, readVideoBudget, scriptEnd } from "./variables";

describe("{{OUTILS_VISUELS}}", () => {
  it("liste les générateurs branchés", () => {
    const text = formatVisualTools({ image: "img-x", video: "vid-y" });
    expect(text).toContain("Modèle vidéo IA : vid-y (type video_ia)");
    expect(text).toContain("Modèle image IA : img-x (type image_ia_animee)");
    expect(text).not.toContain(NO_GENERATOR);
  });

  it("sans générateur, le dit explicitement au modèle", () => {
    const text = formatVisualTools({ image: null, video: null });
    expect(text).toContain("type video_ia interdit");
    expect(text).toContain("type image_ia_animee interdit");
    expect(text).toContain(NO_GENERATOR);
  });
});

describe("{{SCRIPT}}", () => {
  it("sans note : le script seul", () => {
    expect(formatScriptVariable(makeScript(), "  ", makeStoryboard())).toBe(JSON.stringify(makeScript(), null, 2));
  });

  it("note sans storyboard précédent", () => {
    const text = formatScriptVariable(makeScript(), "Moins de vidéo IA.", null);
    expect(text).toContain(`${CORRECTION_HEADING} :\nMoins de vidéo IA.`);
    expect(text).not.toContain("Storyboard précédent");
  });
});

describe("budgets", () => {
  it("BUDGET_SECONDES_VIDEO_IA lisible ou précondition", () => {
    expect(readVideoAiBudget({ videoAiSeconds: "12.5", perVideo: undefined })).toBe(12.5);
    expect(readVideoAiBudget({ videoAiSeconds: "0", perVideo: undefined })).toBe(0);
    expect(() => readVideoAiBudget({ videoAiSeconds: "-3", perVideo: undefined })).toThrow(AgentPreconditionError);
  });

  it("BUDGET_PAR_VIDEO : null s'il est absent ou invalide", () => {
    expect(readVideoBudget({ videoAiSeconds: undefined, perVideo: "5" })).toBe(5);
    expect(readVideoBudget({ videoAiSeconds: undefined, perVideo: "" })).toBeNull();
    expect(readVideoBudget({ videoAiSeconds: undefined, perVideo: "cinq" })).toBeNull();
  });
});

describe("bible et script", () => {
  it("suffixe de style lu dans identite.style_visuel_en, ignoré s'il est vide ou à remplir", () => {
    expect(readStyleSuffix(TEST_BIBLE)).toBe(STYLE_SUFFIX);
    expect(readStyleSuffix(TEST_BIBLE.replace(STYLE_SUFFIX, "{{SUFFIXE_STYLE}}"))).toBeNull();
    expect(readStyleSuffix("pas: [du yaml")).toBeNull();
    expect(readStyleSuffix(null)).toBeNull();
  });

  it("durée à couvrir : fin du dernier beat", () => {
    expect(scriptEnd(makeScript())).toBe(25);
  });
});
