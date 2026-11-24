import { z } from "zod";

// Formulaires du panneau, validés par Zod (hors du fichier "use server", qui n'exporte que des actions).

export type PanelFormState = { ok: boolean; message: string } | null;

export const MAX_ANSWER_LENGTH = 2000;

const activationSchema = z.object({ active: z.enum(["true", "false"]).transform((value) => value === "true") });

/** Interrupteur : la valeur demandée (« true » pour activer). null si le formulaire est illisible. */
export function parseActivationForm(formData: FormData): boolean | null {
  const parsed = activationSchema.safeParse({ active: formData.get("active") });
  return parsed.success ? parsed.data.active : null;
}

const answerSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  reponse: z.string().trim().min(1, "Écris ta réponse : elle part à l'agent comme note de reprise.").max(MAX_ANSWER_LENGTH, `Réponse limitée à ${MAX_ANSWER_LENGTH} caractères.`),
});

export type AnswerForm = { videoId: string; answer: string };

/** Réponse à la question d'une vidéo bloquée ; `error` explique ce qui manque. */
export function parseAnswerForm(formData: FormData): { ok: true; value: AnswerForm } | { ok: false; error: string } {
  const parsed = answerSchema.safeParse({ videoId: formData.get("videoId"), reponse: formData.get("reponse") ?? "" });
  if (parsed.success) return { ok: true, value: { videoId: parsed.data.videoId, answer: parsed.data.reponse } };
  const reponseIssue = parsed.error.issues.find((issue) => issue.path[0] === "reponse");
  return { ok: false, error: reponseIssue?.message ?? "Vidéo inconnue : recharge la page." };
}
