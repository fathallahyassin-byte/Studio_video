import { createHash } from "node:crypto";
import type { MediaKind } from "./generation";
import type { StoryboardVideo } from "./ports";
import { canRegenerateAt } from "./regenerate";
import { MAX_LICENSE_LENGTH, PLAN_FILE_MAX_BYTES, PLAN_FILE_TYPES } from "./ui/limits";
import { parseStoredStoryboard } from "./variables";

// « Ajouter le fichier du plan » : l'humain fournit l'image ou la vidéo d'un plan (séquence libre de droits,
// visuel fait à la main…) avec sa licence. Le fichier part dans le stockage S3 et devient l'Asset du plan,
// que le monteur (agent 7) utilise comme un média généré.

/** Le fournisseur enregistré sur l'Asset d'un fichier ajouté à la main. */
export const MANUAL_PROVIDER = "ajout manuel";

export type PlanFile = { type: string; bytes: Uint8Array };

export type PlanUpload = { videoId: string; planId: string; license: string; file: PlanFile };

export type UploadRecord = { videoId: string; planId: string; kind: MediaKind; url: string; license: string; key: string };

export type UploadPorts = {
  loadVideo(videoId: string): Promise<StoryboardVideo | null>;
  /** null tant que le stockage S3 n'est pas configuré */
  storeFile: ((request: { key: string; bytes: Uint8Array; contentType: string }) => Promise<{ url: string }>) | null;
  /** Asset IMAGE ou VIDEO du plan ; une clé déjà enregistrée (même fichier envoyé deux fois) ne crée rien */
  recordUpload(record: UploadRecord): Promise<void>;
};

export type UploadResult = { ok: boolean; message: string };

const refuse = (message: string): UploadResult => ({ ok: false, message });

/** Refus de forme, avant toute lecture en base : licence, type et taille du fichier. */
export function checkPlanFile(upload: Pick<PlanUpload, "license" | "file">): string | null {
  const license = upload.license.trim();
  if (license === "") return "La licence est obligatoire (ex. « Pexels License, usage commercial autorisé »).";
  if (license.length > MAX_LICENSE_LENGTH) return `La licence fait ${MAX_LICENSE_LENGTH} caractères au plus.`;
  if (!PLAN_FILE_TYPES[upload.file.type]) return "Format refusé : JPEG, PNG, WebP, MP4, MOV ou WebM.";
  if (upload.file.bytes.byteLength === 0) return "Le fichier est vide.";
  if (upload.file.bytes.byteLength > PLAN_FILE_MAX_BYTES) return `Le fichier dépasse ${PLAN_FILE_MAX_BYTES / (1024 * 1024)} Mo.`;
  return null;
}

/** Même fichier pour le même plan = même clé : un double envoi ne crée pas deux Assets. */
export function uploadKey(upload: Pick<PlanUpload, "videoId" | "planId" | "file">): string {
  const digest = createHash("sha256").update(upload.file.bytes).digest("hex");
  return `${upload.videoId}:${upload.planId}:manuel:${digest}`;
}

export function storageKey(upload: Pick<PlanUpload, "videoId" | "planId">, key: string, extension: string): string {
  const digest = key.split(":").at(-1)?.slice(0, 16) ?? "fichier";
  return `videos/${upload.videoId}/plans/${upload.planId}-${digest}.${extension}`;
}

export async function uploadPlanFile(ports: UploadPorts, upload: PlanUpload): Promise<UploadResult> {
  const invalid = checkPlanFile(upload);
  if (invalid) return refuse(invalid);
  if (!ports.storeFile) return refuse("Le stockage S3 n'est pas configuré (S3_* dans .env.local) : impossible d'enregistrer le fichier.");
  const video = await ports.loadVideo(upload.videoId);
  if (!video) return refuse("Vidéo introuvable.");
  if (!canRegenerateAt(video)) return refuse("Un fichier de plan s'ajoute avant le rendu (visuels, montage, ou vidéo bloquée à ces étapes).");
  const plan = parseStoredStoryboard(video.storyboard)?.plans.find((entry) => entry.id === upload.planId);
  if (!plan) return refuse(`Plan ${upload.planId} introuvable dans le storyboard.`);
  if (plan.type === "texte_anime") return refuse(`${plan.id} est un plan de texte animé : il est dessiné au montage, sans fichier.`);

  const format = PLAN_FILE_TYPES[upload.file.type];
  if (!format) return refuse("Format refusé.");
  const key = uploadKey(upload);
  const stored = await ports.storeFile({ key: storageKey(upload, key, format.extension), bytes: upload.file.bytes, contentType: upload.file.type });
  await ports.recordUpload({ videoId: upload.videoId, planId: plan.id, kind: format.kind, url: stored.url, license: upload.license.trim(), key });
  return { ok: true, message: successMessage(plan.id, video) };
}

function successMessage(planId: string, video: Pick<StoryboardVideo, "stage" | "blockedAt">): string {
  const base = `Fichier ajouté pour ${planId}.`;
  if (video.stage === "NEEDS_FIX" && video.blockedAt === "EDIT") {
    return `${base} Quand chaque plan a son fichier, relance l'étape du montage dans « À valider ».`;
  }
  return base;
}
