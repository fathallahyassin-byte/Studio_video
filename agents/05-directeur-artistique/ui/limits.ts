/** Longueur maximale d'un prompt modifié avant « Régénérer ce plan » (formulaire et Server Action). */
export const MAX_PROMPT_LENGTH = 4000;

/** « Ajouter le fichier du plan » : taille maximale (un plan dure 1,5 à 4 s). Garder en phase avec next.config.ts. */
export const PLAN_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_LICENSE_LENGTH = 300;

/** Formats acceptés pour le fichier d'un plan, avec le type d'Asset et l'extension enregistrés. */
export const PLAN_FILE_TYPES: Readonly<Record<string, { kind: "IMAGE" | "VIDEO"; extension: string }>> = {
  "image/jpeg": { kind: "IMAGE", extension: "jpg" },
  "image/png": { kind: "IMAGE", extension: "png" },
  "image/webp": { kind: "IMAGE", extension: "webp" },
  "video/mp4": { kind: "VIDEO", extension: "mp4" },
  "video/quicktime": { kind: "VIDEO", extension: "mov" },
  "video/webm": { kind: "VIDEO", extension: "webm" },
};

export const PLAN_FILE_ACCEPT = Object.keys(PLAN_FILE_TYPES).join(",");
