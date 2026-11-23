// Outils de texte des contrôles : comparaisons sans accents ni casse, phrases, mots, hashtags.

/** Minuscules, sans accents, ponctuation remplacée par des espaces : « Moyen-Âge » → « moyen age ». */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function foldedWords(text: string): string[] {
  const folded = fold(text);
  return folded === "" ? [] : folded.split(" ");
}

/** Mots qui contiennent au moins une lettre ou un chiffre. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

const SENTENCE_END = /[.!?…]+(?=\s|$)/u;

/** Phrases du texte ; un texte sans ponctuation finale compte pour une phrase. */
export function splitSentences(text: string): string[] {
  return text
    .split(new RegExp(SENTENCE_END.source, "gu"))
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

export function firstSentence(text: string): string {
  return splitSentences(text)[0] ?? "";
}

/** Le mot-clé apparaît, mot pour mot, dans le texte (sans tenir compte des accents ni de la casse). */
export function containsKeyword(text: string, keyword: string): boolean {
  return keywordPosition(text, keyword) !== null;
}

/** Rang (en mots) où commence le mot-clé dans le texte, ou null s'il n'y est pas. */
export function keywordPosition(text: string, keyword: string): number | null {
  const words = foldedWords(text);
  const target = foldedWords(keyword);
  if (target.length === 0) return null;
  for (let start = 0; start + target.length <= words.length; start += 1) {
    if (target.every((word, offset) => words[start + offset] === word)) return start;
  }
  return null;
}

/** « moyen âge » → « #moyenâge » ; vide si rien ne reste. */
export function normalizeHashtag(tag: string): string {
  const body = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return body === "" ? "" : `#${body}`;
}

/** Hashtags normalisés, sans doublon (casse et accents ignorés), dans l'ordre d'origine. */
export function normalizeHashtags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags.map(normalizeHashtag)) {
    const key = fold(tag);
    if (tag === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export const HASHTAG_PATTERN = /^#[\p{L}\p{N}_]+$/u;

export function isValidHashtag(tag: string): boolean {
  return HASHTAG_PATTERN.test(tag);
}

/** « #a, b  #c » → ["#a", "#b", "#c"] (saisie de l'humain). */
export function parseHashtagInput(input: string): string[] {
  return normalizeHashtags(input.split(/[\s,;]+/).filter((tag) => tag !== "" && tag !== "#"));
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
