import type { EditPorts } from "./ports";
import { missingPlanIds } from "./rules";
import { parseStoredTimeline } from "./sources";

// « Lancer le rendu » depuis le panneau. Le rendu Remotion (composition, RenderProvider, tâche RENDER)
// est l'étape 6 de la feuille de route, hors de ce dossier : voir NEEDS.md.

export const RENDER_NOT_WIRED =
  "Le rendu Remotion n'est pas encore branché (étape 6 de la feuille de route) : la timeline est prête, la tâche de rendu attend.";

export type RenderAvailability = { enabled: boolean; note: string | null };

/** Aucun moteur de rendu n'existe encore ; la session principale remplacera ce corps (NEEDS.md). */
export function renderAvailability(): RenderAvailability {
  return { enabled: false, note: RENDER_NOT_WIRED };
}

export type RenderRequestResult = { ok: boolean; message: string };

/**
 * Vérifie que la vidéo peut partir au rendu ; sans moteur branché, le dit au lieu de faire semblant.
 * La session principale remplacera la dernière ligne par la (re)mise en file de la tâche RENDER (NEEDS.md).
 */
export async function requestRender(ports: Pick<EditPorts, "loadVideo">, videoId: string): Promise<RenderRequestResult> {
  const video = await ports.loadVideo(videoId);
  if (!video) return { ok: false, message: "Vidéo introuvable." };
  const timeline = parseStoredTimeline(video.timeline);
  if (!timeline) return { ok: false, message: "Cette vidéo n'a pas de timeline lisible : relance le montage." };
  const missing = missingPlanIds(timeline);
  if (missing.length > 0) return { ok: false, message: `Rendu impossible : média manquant pour ${missing.join(", ")}.` };
  if (video.stage !== "RENDER") return { ok: false, message: "La vidéo n'attend pas de rendu à cette étape." };
  return { ok: false, message: renderAvailability().note ?? RENDER_NOT_WIRED };
}
