import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/agents/template";
import { checkBible } from "@/lib/bible/bible";
import { parseAnalystReport, parseIdea, parseQaReport, parseScript } from "@/lib/dashboard/payloads";
import { buildDemoReport, buildDemoVideos, demoBibleValues } from "./demoData";

describe("données de démo", () => {
  it("donnent une bible complète, sans variable à remplir", () => {
    const template = readFileSync(path.resolve(import.meta.dirname, "../../docs/bible.template.yaml"), "utf8");
    const check = checkBible(renderTemplate(template, demoBibleValues));
    expect(check).toMatchObject({ ok: true, placeholders: [] });
  });

  it.each(buildDemoVideos())("respectent les schémas des agents : $title", (video) => {
    expect(parseIdea(video.idea)).not.toBeNull();
    if (video.script) expect(parseScript(video.script)).not.toBeNull();
    if (video.qa) expect(parseQaReport(video.qa)).not.toBeNull();
  });

  it("donnent un rapport d'analyste valide", () => {
    expect(parseAnalystReport(buildDemoReport("video-1"))).not.toBeNull();
  });
});
