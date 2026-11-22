"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { createPrismaStoryboardPorts } from "../ports";
import { regeneratePlan } from "../regenerate";
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
