import type { z } from "zod";

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; error: string };

const MAX_LISTED_ISSUES = 20;

/** Lit le JSON d'une réponse de modèle : brut, entre ```json … ```, ou entre la première et la dernière accolade. */
export function extractJson(text: string): JsonExtraction {
  const candidates = [...new Set([text.trim(), stripCodeFence(text), sliceOuterObject(text)])].filter(
    (candidate) => candidate !== "",
  );
  let lastError = "réponse vide";
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      return { ok: true, value };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, error: `La réponse ne contient pas de JSON lisible (${lastError}).` };
}

function stripCodeFence(text: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? "";
}

function sliceOuterObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

/** Erreurs Zod lisibles par le modèle lors d'une relance. */
export function formatZodIssues(error: z.ZodError): string {
  const lines = error.issues.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".") || "(racine)";
    return `- ${path} : ${issue.message}`;
  });
  const hidden = error.issues.length - MAX_LISTED_ISSUES;
  if (hidden > 0) lines.push(`- … et ${hidden} autre(s) erreur(s)`);
  return lines.join("\n");
}
