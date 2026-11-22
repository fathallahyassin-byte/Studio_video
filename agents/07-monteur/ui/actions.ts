"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { createPrismaEditPorts } from "../ports";
import { requestRender } from "../render";

export type RenderFormState = { ok: boolean; message: string } | null;

const PAGE_PATH = "/agents/07-monteur";

const renderSchema = z.object({ videoId: z.string().trim().min(1).max(64) });

/** « Lancer le rendu » : refusé avec une explication tant que le rendu Remotion n'est pas branché. */
export async function launchRenderAction(_previous: RenderFormState, formData: FormData): Promise<RenderFormState> {
  await requireOwner();
  const parsed = renderSchema.safeParse({ videoId: formData.get("videoId") });
  if (!parsed.success) return { ok: false, message: "Vidéo inconnue." };
  const result = await requestRender(createPrismaEditPorts(), parsed.data.videoId);
  if (result.ok) revalidatePath(PAGE_PATH);
  return result;
}
