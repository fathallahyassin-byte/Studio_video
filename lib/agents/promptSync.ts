// Import de agents/NN-nom/prompt.md dans PromptVersion, au seed.
// Règle : le fichier crée une nouvelle version quand son contenu est nouveau ; elle devient active
// sauf si la version en production a été faite depuis l'interface (on ne l'écrase pas).

export type ExistingPromptVersion = {
  id: string;
  version: number;
  content: string;
  source: "FILE" | "UI";
};

export type PromptSyncPlan =
  | { action: "none" }
  | { action: "activate"; versionId: string }
  | { action: "create"; version: number; activate: boolean };

/** Fins de ligne Windows → Unix, pour qu'un checkout git sous Windows ne crée pas de fausse version. */
export function normalizePromptFile(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function planPromptSync(
  fileContent: string,
  versions: readonly ExistingPromptVersion[],
  activeVersionId: string | null,
): PromptSyncPlan {
  const content = normalizePromptFile(fileContent);
  const same = versions.find((version) => version.content === content);
  if (same) return activeVersionId === null ? { action: "activate", versionId: same.id } : { action: "none" };

  const active = versions.find((version) => version.id === activeVersionId);
  const nextVersion = Math.max(0, ...versions.map((version) => version.version)) + 1;
  return { action: "create", version: nextVersion, activate: active === undefined || active.source === "FILE" };
}
