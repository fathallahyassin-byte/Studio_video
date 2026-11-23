import { describe, expect, it } from "vitest";
import { IDEA, makeReport, makeScript, NOW } from "./fixtures";
import { formatKeywords, formatQaReport, formatSlotsVariable, NO_ANALYST_SLOTS, readIdeaId, requireLabels } from "./variables";

describe("variables du prompt", () => {
  it("{{RAPPORT_QA}} : décision, étiquettes et mentions, sans les 16 points ; étiquettes imposées en clair", () => {
    const text = formatQaReport(makeReport({ mentions_a_incruster: ["Images générées par IA"] }), requireLabels(makeReport()));
    expect(text).toContain('"decision": "GO"');
    expect(text).toContain("Images générées par IA");
    expect(text).not.toContain('"controles"');
    expect(text).toContain("- TikTok : étiquette IA oui, contenu de marque non");
    expect(text).toContain("- YouTube Shorts : étiquette IA non, contenu de marque non");
  });

  it("{{MOTS_CLES}} : une ligne par mot-clé", () => {
    expect(formatKeywords("trombone\n\n  bureau  ")).toBe("- trombone\n- bureau");
  });

  it("{{CRENEAUX}} : l'analyste n'existe pas encore (dit), date du jour, contraintes et créneaux déjà pris", () => {
    const text = formatSlotsVariable({ now: NOW, taken: [{ platform: "TIKTOK", scheduledFor: new Date(2026, 10, 24, 19, 0), videoNumber: 6 }], note: null });
    expect(text.startsWith(NO_ANALYST_SLOTS)).toBe(true);
    expect(text).toContain("2026-11-23T10:00");
    expect(text).toContain("au plus 14 jours");
    expect(text).toContain("- 2026-11-24T19:00 · TikTok · V-006");
    expect(text).not.toContain("NOTE DE L'HUMAIN");
  });

  it("id de l'idée : celui de Video.ideaJson, sinon celui du script", () => {
    expect(readIdeaId(IDEA, makeScript())).toBe("I-07");
    expect(readIdeaId(null, { ...makeScript(), idee_id: "I-99" })).toBe("I-99");
  });
});
