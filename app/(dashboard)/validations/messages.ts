// Messages affichés après une décision (paramètre ?fait=…). Codes fixes : rien de ce que l'URL contient n'est réaffiché.

export const doneMessages = {
  "v1-approved": "Idées validées : elles partent chez le recherchiste.",
  "v1-rejected": "Idées écartées.",
  "v2-approved": "Script validé : le directeur artistique et la voix prennent le relais.",
  "v2-changes": "Correction demandée : le script retourne au scénariste avec ta note.",
  "v3-approved": "GO donné : la vidéo est programmée, l'agent publication prépare les textes.",
  "v3-changes": "Correction demandée : la vidéo retourne à l'étape choisie avec ta note.",
  resumed: "Étape relancée.",
  abandoned: "Vidéo abandonnée.",
} as const;

export type DoneCode = keyof typeof doneMessages;

function isDoneCode(code: string): code is DoneCode {
  return Object.hasOwn(doneMessages, code);
}

export function doneMessage(code: string | string[] | undefined): string | null {
  return typeof code === "string" && isDoneCode(code) ? doneMessages[code] : null;
}
