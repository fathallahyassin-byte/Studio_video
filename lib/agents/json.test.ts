import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, formatZodIssues } from "./json";

describe("extractJson", () => {
  it.each([
    ["brut", '{"a": 1}'],
    ["avec espaces", '  \n{"a": 1}\n '],
    ["entre balises de code", 'Voici :\n```json\n{"a": 1}\n```\nBonne lecture'],
    ["entouré de texte", 'Résultat : {"a": 1} (fin)'],
  ])("lit un JSON %s", (_label, text) => {
    expect(extractJson(text)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("signale une réponse sans JSON", () => {
    const result = extractJson("Je ne peux pas répondre.");
    expect(result.ok).toBe(false);
  });
});

describe("formatZodIssues", () => {
  it("donne le chemin de chaque erreur", () => {
    const schema = z.object({ beats: z.array(z.object({ fin_s: z.number() })) });
    const parsed = schema.safeParse({ beats: [{ fin_s: "trois" }] });
    if (parsed.success) throw new Error("le test attend une erreur");
    expect(formatZodIssues(parsed.error)).toMatch(/^- beats\.0\.fin_s : /);
  });
});
