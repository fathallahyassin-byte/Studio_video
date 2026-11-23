// Résultat d'une tâche : il dit au worker quoi en faire.

export type JobOutcome =
  | { kind: "done"; note?: string }
  | { kind: "retry"; delayMs: number; reason: string; alert?: boolean }
  | { kind: "failed"; reason: string };
