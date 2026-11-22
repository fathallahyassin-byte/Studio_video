import { describe, expect, it } from "vitest";
import { MAX_SOURCES, parseSourceLines } from "./sources";

describe("parseSourceLines", () => {
  it("garde une URL par ligne, sans lignes vides ni doublons", () => {
    expect(parseSourceLines(" https://a.example/x \r\n\r\nhttp://b.example\nhttps://a.example/x\n")).toEqual({
      ok: true,
      urls: ["https://a.example/x", "http://b.example"],
    });
    expect(parseSourceLines("")).toEqual({ ok: true, urls: [] });
  });

  it("refuse ce qui n'est pas une adresse http(s)", () => {
    expect(parseSourceLines("javascript:alert(1)")).toMatchObject({ ok: false, error: expect.stringContaining("javascript:alert(1)") });
    expect(parseSourceLines("ftp://exemple.test")).toMatchObject({ ok: false });
    expect(parseSourceLines("pas une url")).toMatchObject({ ok: false });
  });

  it("limite le nombre de sources", () => {
    const many = Array.from({ length: MAX_SOURCES + 1 }, (_, index) => `https://s${index}.example`).join("\n");
    expect(parseSourceLines(many)).toMatchObject({ ok: false, error: expect.stringContaining(String(MAX_SOURCES)) });
  });
});
