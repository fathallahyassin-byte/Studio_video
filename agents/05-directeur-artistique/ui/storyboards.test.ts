import { describe, expect, it } from "vitest";
import { makeStoryboard, withPlan } from "../fixtures";
import { latestAssets, toStoryboardView, type StoryboardRow } from "./storyboards";
import { NO_PROVIDER_NOTE, regenerationAvailability, summaryLine } from "./summary";

const row: StoryboardRow = {
  id: "video-1",
  label: "V-031",
  title: "Le trombone",
  stage: "EDIT",
  blockedAt: null,
  blockedReason: null,
  updatedLabel: "22 nov., 10:00",
  storyboardJson: makeStoryboard(),
};

describe("toStoryboardView", () => {
  it("une vignette par plan : type, durée, prompt, label IA, état du média", () => {
    const view = toStoryboardView(row, [{ planId: "P02", kind: "IMAGE", url: "https://media.test/p02.png" }], 12);
    expect(view?.plans).toHaveLength(8);
    expect(view?.plans[0]).toMatchObject({ id: "P01", typeLabel: "Vidéo IA", durationLabel: "3 s", timeLabel: "0–3 s", aiLabel: true, isCover: true, regenerable: true });
    expect(view?.plans[1]).toMatchObject({ id: "P02", durationLabel: "2,5 s", media: { state: "generated", url: "https://media.test/p02.png", kind: "IMAGE" } });
    expect(view?.plans[2]).toMatchObject({ id: "P03", regenerable: false, stockKeywords: ["office desk", "paper"], media: { state: "to_source" } });
    expect(view?.plans[3]).toMatchObject({ id: "P04", media: { state: "edit" } });
    expect(view?.plans[4]?.media.state).toBe("to_generate");
    expect(view).toMatchObject({ status: { tone: "ok", notice: null }, editable: true });
  });

  it("total de vidéo IA recalculé et comparé au budget", () => {
    expect(toStoryboardView(row, [], 12)?.budget).toEqual({ totalS: 6, budgetS: 12, over: false, ratio: 0.5 });
    expect(toStoryboardView(row, [], null)?.budget).toEqual({ totalS: 6, budgetS: null, over: false, ratio: 0 });
    const over = toStoryboardView({ ...row, storyboardJson: withPlan("P05", { type: "video_ia" }) }, [], 8);
    expect(over?.budget).toEqual({ totalS: 10, budgetS: 8, over: true, ratio: 1 });
    expect(over?.status.tone).toBe("wait");
  });

  it("vidéo bloquée à l'étape des visuels : en jaune avec la raison", () => {
    const view = toStoryboardView({ ...row, stage: "NEEDS_FIX", blockedAt: "VISUALS_AND_AUDIO", blockedReason: "Budget dépassé" }, [], 12);
    expect(view?.status).toEqual({ label: "À corriger", tone: "wait", notice: "Budget dépassé" });
    expect(view?.editable).toBe(true);
  });

  it("après le rendu, la régénération n'est plus proposée", () => {
    expect(toStoryboardView({ ...row, stage: "QA" }, [], 12)?.editable).toBe(false);
  });

  it("storyboard illisible : null", () => {
    expect(toStoryboardView({ ...row, storyboardJson: { plans: [] } }, [], 12)).toBeNull();
  });
});

describe("latestAssets", () => {
  it("garde le média le plus récent de chaque plan de la vidéo", () => {
    const assets = [
      { videoId: "video-1", planId: "P01", kind: "VIDEO" as const, url: "recent" },
      { videoId: "video-1", planId: "P01", kind: "VIDEO" as const, url: "ancien" },
      { videoId: "video-2", planId: "P02", kind: "IMAGE" as const, url: "autre vidéo" },
    ];
    expect(latestAssets(assets, "video-1")).toEqual([{ planId: "P01", kind: "VIDEO", url: "recent" }]);
  });
});

describe("en-tête du panneau", () => {
  it("sans fournisseur : régénération désactivée avec une note", () => {
    expect(regenerationAvailability({ image: null, video: null })).toEqual({ enabled: false, note: NO_PROVIDER_NOTE });
    expect(regenerationAvailability({ image: "img", video: null })).toEqual({ enabled: true, note: expect.stringContaining("de vidéo") });
    expect(regenerationAvailability({ image: "img", video: "vid" })).toEqual({ enabled: true, note: null });
  });

  it("résumé : en préparation, budget, illisibles", () => {
    expect(summaryLine({ inProgress: 2, unreadable: 1, budgetS: 12.5 })).toBe("2 storyboard(s) en préparation. Budget de vidéo IA : 12,5 s par vidéo. 1 storyboard(s) illisible(s) masqué(s).");
    expect(summaryLine({ inProgress: 0, unreadable: 0, budgetS: null })).toBe("BUDGET_SECONDES_VIDEO_IA n'est pas renseigné dans .env.");
  });
});
