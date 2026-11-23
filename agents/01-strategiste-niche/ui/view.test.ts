import { describe, expect, it } from "vitest";
import { fillTemplate, makeOutput, PAYLOAD } from "../fixtures";
import { countChanges, diffLines } from "./diff";
import { CRITERION_COLUMNS, EMPTY_FORM, parseStoredStrategy, toBibleDraftView, toFormDefaults, toJobStatus, toStrategyView } from "./view";

describe("tableau des niches", () => {
  const view = toStrategyView(makeOutput());

  it("trie par score recalculé et ignore celui du modèle", () => {
    expect(view.candidates.map((candidate) => candidate.scoreLabel).slice(0, 4)).toEqual(["52,5", "49", "48", "45,5"]);
    expect(view.candidates.map((candidate) => candidate.rank)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(view.maxScoreLabel).toBe("57,5");
  });

  it("donne les 7 notes avec leur justification, dans l'ordre des colonnes", () => {
    const first = view.candidates[0];
    expect(first?.notes.map((note) => note.key)).toEqual(CRITERION_COLUMNS.map((column) => column.key));
    expect(first?.notes[0]).toEqual({ key: "demande", label: "Demande", note: 5, why: "note 5, à vérifier" });
    expect(CRITERION_COLUMNS.map((column) => column.weightLabel)).toEqual(["×2", "×1", "×1,5", "×2", "×2", "×1,5", "×1,5"]);
  });

  it("marque le top 3 et la niche recommandée", () => {
    expect(view.candidates.filter((candidate) => candidate.inTop3).map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
    expect(view.candidates.filter((candidate) => candidate.recommended).map((candidate) => candidate.niche)).toEqual(["Histoire cachée des objets"]);
  });

  it("top 3 avec 10 titres, à étudier, recommandation et plan de test", () => {
    expect(view.top3.map((entry) => [entry.niche, entry.scoreLabel, entry.recommended])).toEqual([
      ["Histoire cachée des objets", "52,5", true],
      ["Mots et expressions", "49", false],
      ["Inventions ratées", "48", false],
    ]);
    expect(view.top3[0]?.titles).toHaveLength(10);
    expect(view.top3[0]?.toStudy).toHaveLength(3);
    expect(view.recommendation.risks).toEqual(["Sujets proches de la concurrence"]);
    expect(view.plan).toEqual({ summary: "20 vidéos en 4 semaines", criterion: "40 % de visionnage complet sur 10 vidéos" });
  });

  it("une sortie enregistrée illisible est ignorée", () => {
    expect(parseStoredStrategy({ candidates: [] })).toBeNull();
    expect(parseStoredStrategy(makeOutput())).not.toBeNull();
  });
});

describe("comparaison des bibles", () => {
  it("liste les lignes communes, retirées puis ajoutées", () => {
    expect(diffLines("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("sans bible active, tout est ajouté", () => {
    const lines = diffLines("", "x\ny");
    expect(countChanges(lines)).toEqual({ added: 2, removed: 0 });
  });

  it("brouillon à adopter, déjà adopté ou pas encore enregistré", () => {
    const active = { id: "bible-1", version: 1, content: fillTemplate({ NOM: "Ancienne" }) };
    const pending = toBibleDraftView({ proposed: fillTemplate(), draft: { id: "bible-2", version: 2 }, active });
    expect(pending).toMatchObject({ status: "pending", activeVersion: 1, added: 1, removed: 1 });
    expect(toBibleDraftView({ proposed: fillTemplate(), draft: { id: "bible-2", version: 2 }, active: { ...active, id: "bible-2", version: 2 } }).status).toBe("active");
    expect(toBibleDraftView({ proposed: fillTemplate(), draft: null, active: null })).toMatchObject({ status: "missing", activeVersion: null, removed: 0 });
  });
});

describe("formulaire et état de la tâche", () => {
  it("reprend les réponses de la dernière tâche", () => {
    expect(toFormDefaults(PAYLOAD)).toEqual({
      pistes: "histoire des objets\ninventions ratées",
      heuresParSemaine: "6",
      budgetMensuel: "80",
      objectifRevenus: "500 € par mois dans 12 mois",
      refus: "montrer mon visage\nparler de politique",
    });
    expect(toFormDefaults(null)).toEqual(EMPTY_FORM);
  });

  it("n'affiche l'état de la tâche que s'il apporte quelque chose", () => {
    expect(toJobStatus(null, null)).toBeNull();
    expect(toJobStatus({ status: "DONE", jobKey: "k1", lastError: null }, "k1")).toBeNull();
    expect(toJobStatus({ status: "QUEUED", jobKey: "k2", lastError: "Aucun fournisseur LLM configuré." }, "k1")).toMatchObject({
      label: "En file",
      tone: "run",
      message: expect.stringContaining("Aucun fournisseur LLM"),
    });
    expect(toJobStatus({ status: "DONE", jobKey: "k2", lastError: "3 échecs" }, "k1")).toMatchObject({ label: "Sans résultat", tone: "wait" });
    expect(toJobStatus({ status: "FAILED", jobKey: "k2", lastError: null }, "k1")).toMatchObject({ label: "Échec", tone: "wait" });
  });
});
