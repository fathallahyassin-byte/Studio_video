import { isScalar, isSeq, parseDocument, type Document } from "yaml";

// Lecture et ajout dans le YAML de la bible, sans perdre les commentaires ni les autres clés (comme lib/bible).
// Une BibleVersion n'est jamais modifiée : appendLearnings renvoie le texte d'une NOUVELLE version.

const CRITERION_PATH = ["objectifs", "critere_validation_niche"] as const;
const LEARNINGS_KEY = "apprentissages";
/** valeur du modèle de bible tant que rien n'a été appris */
const EMPTY_LEARNING = /^aucun/i;

function parse(yamlText: string): Document | null {
  const doc = parseDocument(yamlText);
  return doc.errors.length > 0 ? null : doc;
}

/** `objectifs.critere_validation_niche`, ou null s'il manque ou est encore un champ du modèle ({{CRITERE}}). */
export function readNicheCriterion(bible: string | null): string | null {
  if (bible === null) return null;
  const value: unknown = parse(bible)?.getIn([...CRITERION_PATH]);
  if (typeof value !== "string") return null;
  const criterion = value.trim();
  return criterion === "" || criterion.includes("{{") ? null : criterion;
}

/** Apprentissages déjà écrits dans la bible (textes de la liste `apprentissages`). */
export function readLearnings(bible: string): string[] {
  const node: unknown = parse(bible)?.get(LEARNINGS_KEY, true);
  if (!isSeq(node)) return [];
  return node.items.flatMap((item) => (isScalar(item) && typeof item.value === "string" ? [item.value] : []));
}

export type AppendResult = { ok: true; content: string; added: string[] } | { ok: false; error: string };

/**
 * Ajoute les apprentissages à la fin de la liste `apprentissages`, préfixés par la période (« [2026-W48] … »).
 * Retire la ligne « aucun pour l'instant » du modèle, ignore les lignes déjà présentes.
 */
export function appendLearnings(bible: string, lines: readonly string[], period: string): AppendResult {
  const doc = parse(bible);
  if (!doc) return { ok: false, error: "La bible active n'est pas un YAML valide : corrige-la depuis l'écran Bible." };
  const existing = readLearnings(bible);
  const added = newLines(lines, existing).map((line) => `[${period}] ${line}`);
  if (added.length === 0) return { ok: true, content: bible, added: [] };

  const kept = existing.filter((item) => !EMPTY_LEARNING.test(item.trim()));
  const node = doc.createNode([...kept, ...added]);
  const previous: unknown = doc.get(LEARNINGS_KEY, true);
  if (isSeq(previous) && isSeq(node)) {
    node.comment = previous.comment;
    node.commentBefore = previous.commentBefore;
  }
  doc.set(LEARNINGS_KEY, node);
  return { ok: true, content: doc.toString({ lineWidth: 0 }), added };
}

/** Lignes non vides, sans doublon, absentes de la bible (même texte, avec ou sans préfixe de période). */
function newLines(lines: readonly string[], existing: readonly string[]): string[] {
  const known = new Set(existing.map(stripPeriod));
  const result: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "" || known.has(line)) continue;
    known.add(line);
    result.push(line);
  }
  return result;
}

function stripPeriod(item: string): string {
  return item.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
}
