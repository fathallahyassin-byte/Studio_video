import { describe, expect, it } from "vitest";
import { koCheck, makeContext, makeReport, withCheck } from "../fixtures";
import { normalizeReport } from "../rules";
import { describeStatus, safeHttpUrl, toReportView, type ReportRow } from "./reports";

const row = (overrides: Partial<ReportRow> = {}): ReportRow => ({
  id: "video-1",
  label: "V-023",
  title: "Le secret du trombone",
  stage: "AWAITING_V3",
  blockedAt: null,
  updatedLabel: "22 nov., 10:00",
  qaJson: makeReport(),
  renderUrl: "https://media.example.org/rendu.mp4",
  ...overrides,
});

describe("statut du panneau", () => {
  it("jaune seulement quand l'humain doit agir (V3, NO-GO bloqué en contrôle)", () => {
    expect(describeStatus({ stage: "AWAITING_V3", blockedAt: null })).toMatchObject({ tone: "wait", notice: expect.stringContaining("GO final") });
    expect(describeStatus({ stage: "NEEDS_FIX", blockedAt: "QA" })).toMatchObject({ tone: "wait", notice: expect.stringContaining("NO-GO") });
    expect(describeStatus({ stage: "QA", blockedAt: null })).toMatchObject({ tone: "run", notice: null });
    expect(describeStatus({ stage: "PUBLISHED", blockedAt: null })).toMatchObject({ label: "Publiée", tone: "ok", notice: null });
    expect(describeStatus({ stage: "NEEDS_FIX", blockedAt: "SCRIPT" }).notice).toBeNull();
  });
});

describe("toReportView", () => {
  it("range les 16 points en 6 groupes A à F, avec libellés, étiquettes et lien vers le rendu", () => {
    const view = toReportView(row());
    expect(view?.groups.map((group) => group.title)).toEqual(["A. Faits", "B. Originalité", "C. Droits", "D. Transparence", "E. Technique", "F. Bible"]);
    expect(view?.groups[0]?.checks.map((check) => check.label)).toEqual(["Faits conformes au dossier", "Chiffres, dates et noms exacts"]);
    expect(view?.missingChecks).toEqual([]);
    expect(view?.labels).toContainEqual({ name: "TikTok : contenu généré par IA", on: true });
    expect(view?.labels).toContainEqual({ name: "YouTube : contenu modifié ou synthétique", on: false });
    expect(view?.renderHref).toBe("https://media.example.org/rendu.mp4");
    expect(view?.decisionTone).toBe("ok");
  });

  it("un point ko est jaune tant que la vidéo attend l'humain, gris ensuite", () => {
    const qaJson = withCheck("E4", koCheck("Boucler sur le mot trombone", "04-scenariste"), makeReport({ decision: "GO_AVEC_CORRECTIONS" }));
    const awaiting = toReportView(row({ qaJson }));
    const e4 = awaiting?.groups.find((group) => group.group === "E")?.checks.find((check) => check.id === "E4");
    expect(e4).toMatchObject({ statusLabel: "À corriger", tone: "wait", correction: "Boucler sur le mot trombone", agent: "04-scenariste" });
    expect(awaiting).toMatchObject({ koCount: 1, decisionTone: "wait" });
    const published = toReportView(row({ qaJson, stage: "PUBLISHED" }));
    expect(published?.groups.find((group) => group.group === "E")?.checks.find((check) => check.id === "E4")?.tone).toBe("run");
    expect(published?.decisionTone).toBe("run");
  });

  it("marque les points non vérifiés faute de source", () => {
    const qa = makeContext({ available: { STORYBOARD: true, PLAN_SONORE: true, TIMELINE: true, TRANSCRIPTION: false, CAPTURES: true } });
    const view = toReportView(row({ qaJson: normalizeReport(makeReport(), qa), stage: "NEEDS_FIX", blockedAt: "QA" }));
    expect(view?.groups[0]?.checks.every((check) => check.unverified)).toBe(true);
    expect(view?.groups[1]?.checks.some((check) => check.unverified)).toBe(false);
  });

  it("rapport partiel (démonstration) : points absents listés", () => {
    const partial = makeReport({ controles: makeReport().controles.filter((check) => ["A1", "E4"].includes(check.id)) });
    const view = toReportView(row({ qaJson: partial }));
    expect(view?.groups.map((group) => group.group)).toEqual(["A", "E"]);
    expect(view?.missingChecks).toHaveLength(14);
  });

  it("rapport illisible : null ; lien de rendu non http : masqué", () => {
    expect(toReportView(row({ qaJson: { decision: "GO" } }))).toBeNull();
    expect(toReportView(row({ renderUrl: "s3://bucket/rendu.mp4" }))?.renderHref).toBeNull();
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
