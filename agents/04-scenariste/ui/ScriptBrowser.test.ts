import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeDossier, makeScript } from "../fixtures";
import type { ScriptTarget } from "../rules";
import { ScriptBrowser } from "./ScriptBrowser";
import { toScriptView, type ScriptRow, type ScriptView } from "./scripts";

// Rendu HTML du navigateur de scripts (sans navigateur) : structure, accessibilité, jaune réservé.

const TARGET: ScriptTarget = { durationS: 25, minDurationS: 20, maxDurationS: 30, wordsPerSecond: 2 };

function view(overrides: Partial<ScriptRow>): ScriptView {
  const row: ScriptRow = {
    id: "video-1",
    label: "V-007",
    title: "Le trombone",
    stage: "AWAITING_V2",
    blockedAt: null,
    updatedLabel: "22 nov., 10:00",
    lastV2Decision: null,
    lastV2Note: null,
    scriptJson: makeScript(),
    dossierJson: makeDossier(),
    ...overrides,
  };
  const result = toScriptView(row, TARGET);
  if (!result) throw new Error("script d'exemple illisible");
  return result;
}

const render = (scripts: ScriptView[]) => renderToStaticMarkup(createElement(ScriptBrowser, { scripts }));

describe("ScriptBrowser", () => {
  it("affiche le premier script : 3 accroches, frise, beats et ids de faits en vrais boutons", () => {
    const html = render([view({}), view({ id: "video-2", label: "V-008", stage: "EDIT", lastV2Decision: "APPROVED" })]);
    expect(html.match(/Recommandée/g)).toHaveLength(1);
    expect(html).toContain("Mise en situation");
    expect(html).toContain("Frise minutée");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>F1<\/button>/);
    expect(html).toContain("Mots (recomptés)");
    expect(html).toContain("±0 s (±0 %)");
    expect(html).toContain('href="/validations?item=video-1"');
  });

  it("le jaune n'apparaît que pour un script qui attend l'humain", () => {
    const yellow = /[\s"]bg-wait[\s"]/;
    expect(render([view({})])).toMatch(yellow);
    expect(render([view({ stage: "EDIT", lastV2Decision: "APPROVED" })])).not.toMatch(yellow);
  });
});
