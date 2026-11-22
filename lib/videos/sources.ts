// Liens de sources saisis par l'humain pour le recherchiste (Video.researchSources).

export const MAX_SOURCES = 20;

export type SourcesParse = { ok: true; urls: string[] } | { ok: false; error: string };

/** Une URL http(s) par ligne ; lignes vides ignorées, doublons retirés, 20 au maximum. */
export function parseSourceLines(text: string): SourcesParse {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const urls = [...new Set(lines)];
  if (urls.length > MAX_SOURCES) return { ok: false, error: `${MAX_SOURCES} sources au maximum.` };
  const invalid = urls.find((url) => !isHttpUrl(url));
  if (invalid !== undefined) return { ok: false, error: `Adresse invalide (http ou https uniquement) : ${invalid}` };
  return { ok: true, urls };
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}
