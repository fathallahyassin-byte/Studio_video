import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { IDEA, makeDossier, makeScript, TEST_BIBLE } from "./fixtures";
import {
  CORRECTION_HEADING,
  formatDuration,
  formatIdeaVariable,
  formatLearnings,
  formatPublishedScripts,
  NO_LEARNINGS,
  NO_PUBLISHED_SCRIPTS,
  readDossier,
  readLearnings,
  readScriptTarget,
} from "./variables";

const TEMPLATE_BIBLE = readFileSync(path.join(import.meta.dirname, "../../docs/bible.template.yaml"), "utf8");

describe("{{DUREE_S}} et débit lus dans la bible", () => {
  it("prend le milieu de duree_cible_s et le débit de la voix", () => {
    expect(readScriptTarget(TEST_BIBLE)).toEqual({ durationS: 25, minDurationS: 20, maxDurationS: 30, wordsPerSecond: 2 });
  });

  it("garde la demi-seconde du modèle de bible : [65, 90] → 77.5", () => {
    const target = readScriptTarget(TEMPLATE_BIBLE);
    expect(target).toMatchObject({ durationS: 77.5, wordsPerSecond: 2.6 });
    expect(formatDuration(target.durationS)).toBe("77.5");
    expect(formatDuration(25)).toBe("25");
  });

  it("refuse l'appel sans bible, avec une bible incomplète ou sans débit", () => {
    expect(() => readScriptTarget(null)).toThrow(AgentPreconditionError);
    expect(() => readScriptTarget("chaine: {}")).toThrow(/Bible inutilisable/);
    expect(() => readScriptTarget(TEST_BIBLE.replace("  debit_voix_mots_par_s: 2\n", ""))).toThrow(AgentPreconditionError);
  });
});

describe("dossier factuel", () => {
  it("absent ou illisible : précondition, aucun appel", () => {
    expect(() => readDossier(null)).toThrow(/pas de dossier factuel/);
    expect(() => readDossier({ faits: "aucun" })).toThrow(/illisible/);
    expect(readDossier(makeDossier()).faits).toHaveLength(3);
  });
});

describe("{{IDEE}} et la note de l'humain", () => {
  it("sans note : l'idée en JSON seulement", () => {
    expect(formatIdeaVariable(IDEA, null, makeScript())).toBe(JSON.stringify(IDEA, null, 2));
    expect(formatIdeaVariable(IDEA, "   ", null)).toBe(JSON.stringify(IDEA, null, 2));
  });

  it("avec une note de correction V2 : la note sous un intitulé clair, puis le script précédent", () => {
    const text = formatIdeaVariable(IDEA, "Accroche trop lente, commence par 1899.", makeScript());
    expect(text).toContain(`${CORRECTION_HEADING} :\nAccroche trop lente, commence par 1899.`);
    expect(text).toContain("Script précédent");
    expect(text).toContain("Le vrai inventeur du trombone");
  });

  it("avec une note mais sans script précédent : la note seule", () => {
    const text = formatIdeaVariable(IDEA, "Reprise après blocage.", null);
    expect(text).toContain("Reprise après blocage.");
    expect(text).not.toContain("Script précédent");
  });
});

describe("{{APPRENTISSAGES}}", () => {
  it("formate les enseignements du dernier rapport, ou « aucun »", () => {
    const learnings = readLearnings({ enseignements: [{ observation: "Les chutes chiffrées retiennent", nb_videos: 4, confiance: "moyenne", decision: "finir sur un chiffre" }] });
    expect(formatLearnings(learnings)).toBe("- Les chutes chiffrées retiennent (confiance moyenne, 4 vidéo(s)) → décision : finir sur un chiffre");
    expect(formatLearnings(readLearnings(null))).toBe(NO_LEARNINGS);
    expect(readLearnings({ enseignements: "illisible" })).toEqual([]);
  });
});

describe("{{DERNIERS_SCRIPTS}}", () => {
  it("résume ouverture, ordre et fin de chaque script lisible, ou « aucun »", () => {
    const text = formatPublishedScripts([makeScript(), { abime: true }]);
    expect(text).toContain("« Le vrai inventeur du trombone »");
    expect(text).toContain("ouverture (affirmation) : Ton trombone cache un secret industriel.");
    expect(text).toContain("ordre : accroche → contexte → revelation → chute → boucle");
    expect(text).toContain("fin : Alors, qui a inventé ton trombone ?");
    expect(text.match(/^- «/gm)).toHaveLength(1);
    expect(formatPublishedScripts([])).toBe(NO_PUBLISHED_SCRIPTS);
  });
});
