import type { ToolNames } from "../variables";

// Textes d'en-tête du panneau (fonctions pures).

export const NO_PROVIDER_NOTE =
  "Aucun fournisseur d'images ni de vidéo IA n'est branché : la génération des médias et « Régénérer ce plan » sont désactivées. Le prompt reste modifiable pour préparer la relance.";

export function regenerationAvailability(tools: ToolNames): { enabled: boolean; note: string | null } {
  if (tools.image === null && tools.video === null) return { enabled: false, note: NO_PROVIDER_NOTE };
  const missing = [tools.image === null ? "d'images" : null, tools.video === null ? "de vidéo" : null].filter((entry) => entry !== null);
  return { enabled: true, note: missing.length > 0 ? `Aucun fournisseur ${missing.join(" ni ")} IA : les plans de ce type ne se régénèrent pas.` : null };
}

export function summaryLine(input: { inProgress: number; unreadable: number; budgetS: number | null }): string {
  const parts = [
    input.inProgress > 0 ? `${input.inProgress} storyboard(s) en préparation.` : null,
    input.budgetS === null ? "BUDGET_SECONDES_VIDEO_IA n'est pas renseigné dans .env." : `Budget de vidéo IA : ${String(input.budgetS).replace(".", ",")} s par vidéo.`,
    input.unreadable > 0 ? `${input.unreadable} storyboard(s) illisible(s) masqué(s).` : null,
  ];
  return parts.filter((part) => part !== null).join(" ");
}
