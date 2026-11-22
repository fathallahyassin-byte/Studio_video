// Temps de la timeline calés sur l'image : le rendu est à 30 images/s (prompt, AGENT.md).

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Image la plus proche d'un instant. */
export function frameOf(seconds: number): number {
  return Math.round(seconds * FPS);
}

/** Début d'une image, en secondes arrondies au millième (valeur enregistrée dans la timeline). */
export function secondsOf(frame: number): number {
  return Math.round((frame / FPS) * 1000) / 1000;
}

/** Instant ramené au début de l'image la plus proche. */
export function snap(seconds: number): number {
  return secondsOf(frameOf(seconds));
}
