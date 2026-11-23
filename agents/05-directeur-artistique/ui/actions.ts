"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { createPrismaStoryboardPorts } from "../ports";
import { regeneratePlan } from "../regenerate";
import { uploadPlanFile } from "../upload";
import { createPrismaUploadPorts } from "../uploadPorts";
import { MAX_PROMPT_LENGTH } from "./limits";

export type RegenerateFormState = { ok: boolean; message: string } | null;

const PAGE_PATH = "/agents/05-directeur-artistique";

const regenerateSchema = z.object({
  videoId: z.string().min(1),
  planId: z.string().regex(/^P\d+$/),
  prompt: z.string().trim().min(10).max(MAX_PROMPT_LENGTH),
});

/** « Régénérer ce plan » : nouvelle tentative avec le prompt modifié, dans la limite du budget de la vidéo. */
export async function regeneratePlanAction(_previous: RegenerateFormState, formData: FormData): Promise<RegenerateFormState> {
  await requireOwner();
  const parsed = regenerateSchema.safeParse({ videoId: formData.get("videoId"), planId: formData.get("planId"), prompt: formData.get("prompt") });
  if (!parsed.success) return { ok: false, message: `Le prompt doit faire de 10 à ${MAX_PROMPT_LENGTH} caractères.` };
  const result = await regeneratePlan(createPrismaStoryboardPorts(), parsed.data);
  if (result.ok) revalidatePath(PAGE_PATH);
  return result;
}

export type UploadFormState = { ok: boolean; message: string } | null;

const uploadSchema = z.object({
  videoId: z.string().min(1),
  planId: z.string().regex(/^P\d+$/),
  license: z.string(),
  file: z.instanceof(File),
});

/** « Ajouter le fichier du plan » : envoi au stockage S3 et Asset du plan, utilisé par le monteur. */
export async function uploadPlanFileAction(_previous: UploadFormState, formData: FormData): Promise<UploadFormState> {
  await requireOwner();
  const parsed = uploadSchema.safeParse({ videoId: formData.get("videoId"), planId: formData.get("planId"), license: formData.get("license"), file: formData.get("file") });
  if (!parsed.success) return { ok: false, message: "Choisis un fichier et renseigne sa licence." };
  const { file, ...rest } = parsed.data;
  const result = await uploadPlanFile(createPrismaUploadPorts(), { ...rest, file: { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } });
  if (result.ok) {
    revalidatePath(PAGE_PATH);
    revalidatePath("/agents/07-monteur");
  }
  return result;
}
