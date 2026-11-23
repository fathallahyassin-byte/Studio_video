import { isStorageConfigured } from "@/lib/providers/storage";
import type { EditPorts } from "./ports";
import { missingPlanIds } from "./rules";
import { parseStoredTimeline } from "./sources";

// « Lancer le rendu » depuis le panneau : remet en file la tâche RENDER du worker (rendu Remotion,
// jobs/render.ts). Le rendu part aussi tout seul quand la vidéo arrive à l'étape du rendu.

export const RENDER_NOT_CONFIGURED =
  "Le stockage S3 n'est pas configuré (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL) : le worker n'a nulle part où déposer le MP4.";

export type RenderAvailability = { enabled: boolean; note: string | null };

export function renderAvailability(env: Record<string, string | undefined> = process.env): RenderAvailability {
  return isStorageConfigured(env) ? { enabled: true, note: null } : { enabled: false, note: RENDER_NOT_CONFIGURED };
}

export type RenderRequestResult = { ok: boolean; message: string };

/** Vérifie que la vidéo peut partir au rendu, puis remet la tâche en file. */
export async function requestRender(
  ports: Pick<EditPorts, "loadVideo" | "queueRender">,
  videoId: string,
  availability: RenderAvailability = renderAvailability(),
): Promise<RenderRequestResult> {
  const video = await ports.loadVideo(videoId);
  if (!video) return { ok: false, message: "Vidéo introuvable." };
  const timeline = parseStoredTimeline(video.timeline);
  if (!timeline) return { ok: false, message: "Cette vidéo n'a pas de timeline lisible : relance le montage." };
  const missing = missingPlanIds(timeline);
  if (missing.length > 0) return { ok: false, message: `Rendu impossible : média manquant pour ${missing.join(", ")}.` };
  if (video.stage !== "RENDER") return { ok: false, message: "La vidéo n'attend pas de rendu à cette étape." };
  if (!availability.enabled) return { ok: false, message: availability.note ?? RENDER_NOT_CONFIGURED };
  const queued = await ports.queueRender(videoId);
  return queued.queued ? { ok: true, message: "Rendu mis en file : le worker le lance dès qu'il est libre." } : { ok: false, message: queued.reason };
}
