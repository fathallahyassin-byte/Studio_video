"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/owner";
import { getPipelineDeps, ownerActor } from "@/lib/pipeline/deps";
import { resumeVideo, TransitionError } from "@/lib/pipeline/service";
import { createPrismaActivationPorts, switchOrchestrator } from "../activation";
import { parseActivationForm, parseAnswerForm, type PanelFormState } from "./forms";

/** Interrupteur Activé / Désactivé : change Agent.active de l'agent 0. */
export async function setOrchestratorActiveAction(_previous: PanelFormState, formData: FormData): Promise<PanelFormState> {
  await requireOwner();
  const active = parseActivationForm(formData);
  if (active === null) return { ok: false, message: "Choix illisible : recharge la page." };
  const result = await switchOrchestrator(createPrismaActivationPorts(getPipelineDeps().db), active);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * Réponse à la question d'une vidéo bloquée : transmise comme note de reprise (resumeVideo), décidée par l'humain.
 * La vidéo repart à l'étape où elle était bloquée ; l'agent de cette étape lit la réponse dans sa note.
 */
export async function answerBlockedVideoAction(_previous: PanelFormState, formData: FormData): Promise<PanelFormState> {
  await requireOwner();
  const parsed = parseAnswerForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  try {
    await resumeVideo(getPipelineDeps(), { videoId: parsed.value.videoId, actor: ownerActor(), note: parsed.value.answer });
  } catch (error) {
    if (error instanceof TransitionError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Réponse transmise : l'étape est relancée avec ta note." };
}
