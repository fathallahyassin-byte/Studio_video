"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { createPrismaAudioPorts } from "../ports";
import { chooseMusic, regenerateVoice } from "../regenerate";
import { MAX_LICENSE_LENGTH, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, MAX_URL_LENGTH } from "./limits";

export type AudioFormState = { ok: boolean; message: string } | null;

const PAGE_PATH = "/agents/06-voix-son";

const regenerateSchema = z.object({
  videoId: z.string().min(1),
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
});

/** « Régénérer la voix » : nouvelle tentative avec le texte modifié, dans la limite du budget de la vidéo. */
export async function regenerateVoiceAction(_previous: AudioFormState, formData: FormData): Promise<AudioFormState> {
  await requireOwner();
  const parsed = regenerateSchema.safeParse({ videoId: formData.get("videoId"), text: formData.get("text") });
  if (!parsed.success) return { ok: false, message: `Le texte TTS doit faire de 1 à ${MAX_TEXT_LENGTH} caractères.` };
  const result = await regenerateVoice(createPrismaAudioPorts(), parsed.data);
  if (result.ok) revalidatePath(PAGE_PATH);
  return result;
}

const musicSchema = z.object({
  videoId: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  url: z.url({ protocol: /^https?$/ }).max(MAX_URL_LENGTH),
  license: z.string().trim().min(3).max(MAX_LICENSE_LENGTH),
});

/** Piste choisie par l'humain : la licence est obligatoire (sans elle, rien n'est enregistré). */
export async function chooseMusicAction(_previous: AudioFormState, formData: FormData): Promise<AudioFormState> {
  await requireOwner();
  const parsed = musicSchema.safeParse({ videoId: formData.get("videoId"), title: formData.get("title"), url: formData.get("url"), license: formData.get("license") });
  if (!parsed.success) return { ok: false, message: "Renseigne le titre, une adresse http(s) et la licence de la piste (obligatoire)." };
  const result = await chooseMusic(createPrismaAudioPorts(), parsed.data);
  if (result.ok) revalidatePath(PAGE_PATH);
  return result;
}
