import { describe, expect, it } from "vitest";
import { deriveAgentState } from "./agentStatus";
import { buildBoard, cardStatus, displayStage } from "./board";
import { formatMoney, formatRelative, formatTimeRange, formatVideoNumber } from "./format";
import { buildQueue, selectQueueItem } from "./queue";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 22, 10, minutes));

describe("tableau de production", () => {
  const videos = [
    { id: "a", number: 31, title: "Capsules", stage: "AWAITING_V1" as const, blockedAt: null },
    { id: "b", number: 27, title: "Crayons", stage: "AWAITING_V2" as const, blockedAt: null },
    { id: "c", number: 26, title: "Boutons", stage: "NEEDS_FIX" as const, blockedAt: "RESEARCH" as const },
    { id: "d", number: 20, title: "Rejetée", stage: "REJECTED" as const, blockedAt: null },
    { id: "e", number: 21, title: "Conserve", stage: "PUBLISHED" as const, blockedAt: null },
  ];

  it("range chaque vidéo dans sa colonne, et une vidéo à corriger dans la colonne de l'étape à reprendre", () => {
    const board = buildBoard(videos);
    expect(board.map((column) => column.cards.map((card) => card.id))).toEqual([["a"], ["c"], ["b"], [], [], ["e"]]);
  });

  it("met en jaune seulement ce qui attend l'humain", () => {
    expect(cardStatus("AWAITING_V2")).toEqual({ tone: "wait", label: "À valider" });
    expect(cardStatus("NEEDS_FIX")).toEqual({ tone: "wait", label: "À corriger" });
    expect(cardStatus("EDIT")).toEqual({ tone: "run", label: "En cours" });
    expect(cardStatus("SCHEDULED")).toEqual({ tone: "ok", label: "Programmée" });
    expect(displayStage({ stage: "REJECTED", blockedAt: null })).toBeNull();
  });
});

describe("file de validation", () => {
  const videos = [
    { id: "v3", number: 23, title: "Trombone", stage: "AWAITING_V3" as const, updatedAt: at(50) },
    { id: "i1", number: 31, title: "Capsules", stage: "AWAITING_V1" as const, updatedAt: at(10) },
    { id: "s2", number: 28, title: "Code-barres", stage: "AWAITING_V2" as const, updatedAt: at(40) },
    { id: "s1", number: 27, title: "Crayons", stage: "AWAITING_V2" as const, updatedAt: at(20) },
    { id: "i2", number: 32, title: "Pince", stage: "AWAITING_V1" as const, updatedAt: at(30) },
  ];

  it("regroupe les idées en une entrée V1, puis V2 et V3 du plus ancien au plus récent", () => {
    const queue = buildQueue(videos);
    expect(queue.map((item) => [item.key, item.gate, item.title])).toEqual([
      ["v1", "V1", "2 idées à trier"],
      ["s1", "V2", "Crayons"],
      ["s2", "V2", "Code-barres"],
      ["v3", "V3", "Trombone"],
    ]);
    expect(queue[0]).toMatchObject({ videoIds: ["i1", "i2"], since: at(30) });
  });

  it("sélectionne l'entrée demandée, ou la première", () => {
    const queue = buildQueue(videos);
    expect(selectQueueItem(queue, "s2")?.key).toBe("s2");
    expect(selectQueueItem(queue, "inconnue")?.key).toBe("v1");
    expect(selectQueueItem([], undefined)).toBeUndefined();
  });
});

describe("état des agents", () => {
  it("travaille, attend une validation, se repose ou est désactivé", () => {
    const stages = new Set(["SCRIPT", "AWAITING_V3", "AWAITING_V1"] as const);
    expect(deriveAgentState({ id: 4, active: true }, stages)).toBe("working");
    expect(deriveAgentState({ id: 8, active: true }, stages)).toBe("waiting");
    expect(deriveAgentState({ id: 2, active: true }, stages)).toBe("waiting");
    expect(deriveAgentState({ id: 9, active: true }, stages)).toBe("idle");
    expect(deriveAgentState({ id: 4, active: false }, stages)).toBe("disabled");
  });
});

describe("formats", () => {
  it("affiche montants, numéros, durées et dates relatives en français", () => {
    expect(formatMoney(1.5).replace(/\s/g, " ")).toBe("1,50 €");
    expect(formatVideoNumber(31)).toBe("V-031");
    expect(formatTimeRange(0, 3)).toBe("0–3 s");
    expect(formatTimeRange(10.5, 40)).toBe("10,5–40 s");
    expect(formatRelative(at(0), at(40))).toBe("il y a 40 min");
    expect(formatRelative(at(0), new Date(at(0).getTime() + 3 * 3600_000))).toBe("il y a 3 h");
  });
});
