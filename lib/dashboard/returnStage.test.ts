import { describe, expect, it } from "vitest";
import { buildDemoVideos } from "@/lib/demo/demoData";
import type { QaReport } from "./payloads";
import { suggestReturnStage } from "./queries";

function reportWithKo(agent: string | null): QaReport {
  const demo = buildDemoVideos().find((video) => video.qa)?.qa;
  if (!demo) throw new Error("rapport de démonstration absent");
  return { ...demo, controles: [{ id: "A1", statut: "ko", preuve: "faux", correction: "corriger", agent_responsable: agent }] };
}

describe("suggestReturnStage", () => {
  it("renvoie à l'étape de l'agent responsable du premier point « ko »", () => {
    expect(suggestReturnStage(reportWithKo("03-recherchiste"))).toBe("SCRIPT");
    expect(suggestReturnStage(reportWithKo("04-scenariste"))).toBe("SCRIPT");
    expect(suggestReturnStage(reportWithKo("06-voix-son"))).toBe("VISUALS_AND_AUDIO");
    expect(suggestReturnStage(reportWithKo("08-controle-qualite"))).toBe("QA");
    expect(suggestReturnStage(reportWithKo("07-monteur"))).toBe("EDIT");
    expect(suggestReturnStage(null)).toBe("EDIT");
  });

  it("le rapport de démonstration a les 16 points de la check-list", () => {
    const demo = buildDemoVideos().find((video) => video.qa)?.qa;
    expect(demo?.controles.map((check) => check.id)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "D3", "D4", "D5", "E1", "E2", "E3", "E4", "F1"]);
  });
});
