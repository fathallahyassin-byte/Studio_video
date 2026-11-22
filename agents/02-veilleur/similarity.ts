// Similarité simple entre titres : mots significatifs communs (coefficient de Dice),
// après minuscules, accents retirés, mots vides et pluriels simples écartés.

/** Au-delà de ce seuil, une idée est jugée trop proche d'un titre existant. */
export const BACKLOG_SIMILARITY_THRESHOLD = 0.6;

const STOP_WORDS = new Set([
  "a", "au", "aux", "avec", "ce", "ces", "cette", "comment", "d", "dans", "de", "des", "du", "elle", "en", "est", "et",
  "il", "ils", "l", "la", "le", "les", "leur", "leurs", "mais", "n", "ne", "on", "ou", "par", "pas", "plus", "pour",
  "pourquoi", "qu", "quand", "que", "quel", "quelle", "quels", "quelles", "qui", "quoi", "s", "sa", "se", "ses", "son",
  "sont", "sur", "t", "ta", "tes", "ton", "tu", "un", "une", "vos", "votre", "vous", "y",
]);

/** Minuscules, sans accents ni ponctuation. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singular(word: string): string {
  return word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

/** Mots significatifs d'un titre, au singulier. */
export function titleWords(title: string): Set<string> {
  const words = normalizeText(title).split(" ").filter((word) => word !== "" && !STOP_WORDS.has(word));
  return new Set(words.map(singular));
}

/** 0 (aucun mot commun) à 1 (mêmes mots significatifs). */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = titleWords(a);
  const wordsB = titleWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return (2 * shared) / (wordsA.size + wordsB.size);
}

/** Le titre existant le plus proche, s'il atteint le seuil ; sinon null. */
export function findSimilarTitle(title: string, existing: readonly string[], threshold = BACKLOG_SIMILARITY_THRESHOLD): string | null {
  let best: { title: string; score: number } | null = null;
  for (const candidate of existing) {
    const score = titleSimilarity(title, candidate);
    if (score >= threshold && (best === null || score > best.score)) best = { title: candidate, score };
  }
  return best?.title ?? null;
}
