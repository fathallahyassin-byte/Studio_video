import { describe, expect, it } from "vitest";
import { backoffMs } from "@/lib/queue/queue";
import { isDueThisMonth, isDueThisWeek, monthKey } from "./schedule";

describe("planning hebdomadaire", () => {
  const veille = { name: "veille" as const, hour: 7 };
  const monday = (hour: number) => new Date(2026, 10, 23, hour, 30);

  it("attend lundi 7 h pour la veille, puis la rattrape le reste de la semaine", () => {
    expect(isDueThisWeek(veille, monday(6))).toBe(false);
    expect(isDueThisWeek(veille, monday(7))).toBe(true);
    expect(isDueThisWeek(veille, new Date(2026, 10, 25, 3))).toBe(true);
    expect(isDueThisWeek(veille, new Date(2026, 10, 29, 23))).toBe(true);
  });
});

describe("relances", () => {
  it("double le délai à chaque essai, sans dépasser une heure", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(20)).toBe(60 * 60 * 1000);
  });
});

describe("rappel mensuel du stratège", () => {
  it("attend le 1er à 9 h, puis le rattrape le reste du mois", () => {
    expect(isDueThisMonth(9, new Date(2026, 11, 1, 8, 59))).toBe(false);
    expect(isDueThisMonth(9, new Date(2026, 11, 1, 9))).toBe(true);
    expect(isDueThisMonth(9, new Date(2026, 11, 2, 0))).toBe(true);
    expect(isDueThisMonth(9, new Date(2026, 11, 31, 23))).toBe(true);
  });

  it("clé du mois en heure locale", () => {
    expect(monthKey(new Date(2026, 11, 31, 23))).toBe("2026-12");
    expect(monthKey(new Date(2027, 0, 1, 0))).toBe("2027-01");
  });
});
