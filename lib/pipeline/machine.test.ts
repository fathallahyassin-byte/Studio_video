import { describe, expect, it } from "vitest";
import type { Stage } from "@/lib/generated/prisma/client";
import { transition, type PipelineEvent } from "./machine";

const go = (stage: Stage, event: PipelineEvent, extra: { blockedAt?: Stage | null; returnTo?: "SCRIPT" | "VISUALS_AND_AUDIO" | "EDIT" | "QA"; hasV3Approval?: boolean } = {}) =>
  transition({ stage, event, blockedAt: extra.blockedAt ?? null, returnTo: extra.returnTo, hasV3Approval: extra.hasV3Approval });

describe("parcours nominal", () => {
  it("mène une idée jusqu'à la publication, dans l'ordre de CLAUDE.md", () => {
    const steps: [PipelineEvent, Stage][] = [
      ["IDEA_PROPOSED", "AWAITING_V1"],
      ["V1_APPROVED", "RESEARCH"],
      ["RESEARCH_DONE", "SCRIPT"],
      ["SCRIPT_DONE", "AWAITING_V2"],
      ["V2_APPROVED", "VISUALS_AND_AUDIO"],
      ["MEDIA_DONE", "EDIT"],
      ["EDIT_DONE", "RENDER"],
      ["RENDER_DONE", "QA"],
      ["QA_PASSED", "AWAITING_V3"],
      ["V3_APPROVED", "SCHEDULED"],
      ["PUBLISHED", "PUBLISHED"],
    ];
    let stage: Stage = "IDEA";
    for (const [event, expected] of steps) {
      const result = go(stage, event, { hasV3Approval: true });
      if (!result.ok) throw new Error(result.reason);
      expect(result.to).toBe(expected);
      stage = result.to;
    }
  });
});

describe("validations humaines", () => {
  it("ne saute jamais une validation", () => {
    expect(go("SCRIPT", "V2_APPROVED").ok).toBe(false);
    expect(go("QA", "V3_APPROVED").ok).toBe(false);
    expect(go("RESEARCH", "V1_APPROVED").ok).toBe(false);
    expect(go("AWAITING_V2", "MEDIA_DONE").ok).toBe(false);
    expect(go("AWAITING_V3", "PUBLISHED", { hasV3Approval: true }).ok).toBe(false);
  });

  it("refuse la publication sans validation V3 approuvée", () => {
    expect(go("SCHEDULED", "PUBLISHED", { hasV3Approval: false })).toMatchObject({ ok: false, reason: expect.stringContaining("V3") });
  });

  it("renvoie au script après une correction demandée en V2", () => {
    expect(go("AWAITING_V2", "V2_CHANGES_REQUESTED")).toMatchObject({ ok: true, to: "SCRIPT" });
  });

  it("renvoie à l'étape choisie après une correction demandée en V3", () => {
    expect(go("AWAITING_V3", "V3_CHANGES_REQUESTED", { returnTo: "VISUALS_AND_AUDIO" })).toMatchObject({ ok: true, to: "VISUALS_AND_AUDIO" });
    expect(go("AWAITING_V3", "V3_CHANGES_REQUESTED")).toMatchObject({ ok: true, to: "EDIT" });
  });

  it("écarte une idée en V1", () => {
    expect(go("AWAITING_V1", "V1_REJECTED")).toMatchObject({ ok: true, to: "REJECTED" });
  });
});

describe("blocage et reprise", () => {
  it("bloque une étape de travail en gardant l'étape à reprendre", () => {
    expect(go("SCRIPT", "BLOCKED")).toEqual({ ok: true, from: "SCRIPT", to: "NEEDS_FIX", blockedAt: "SCRIPT" });
    expect(go("AWAITING_V2", "BLOCKED").ok).toBe(false);
    expect(go("NEEDS_FIX", "BLOCKED").ok).toBe(false);
  });

  it("reprend à l'étape bloquée", () => {
    expect(go("NEEDS_FIX", "RESUMED", { blockedAt: "RESEARCH" })).toEqual({ ok: true, from: "NEEDS_FIX", to: "RESEARCH", blockedAt: null });
    expect(go("NEEDS_FIX", "RESUMED", { blockedAt: null }).ok).toBe(false);
    expect(go("SCRIPT", "RESUMED", { blockedAt: "SCRIPT" }).ok).toBe(false);
  });

  it("abandonne tout sauf une vidéo publiée ou déjà écartée", () => {
    expect(go("NEEDS_FIX", "ABANDONED")).toMatchObject({ ok: true, to: "REJECTED" });
    expect(go("PUBLISHED", "ABANDONED").ok).toBe(false);
    expect(go("REJECTED", "ABANDONED").ok).toBe(false);
  });
});
